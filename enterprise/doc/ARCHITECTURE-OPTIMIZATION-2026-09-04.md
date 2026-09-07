# 企业业务层架构优化记录（2026-09-04）

基于 `ARCHITECTURE-REVIEW-2026-09-04.md` 的审查结论，本次落地了可验证的优化，并交付了
跨包去重方案（因当前环境无 `pnpm`，未做硬连线）。

## 一、本次已落地的改动（全部通过 `tsc` 编译验证）

### 1. biz-order：打通数据孤岛，让工具能被链式多次调用
- `types.ts`：`Order` 增加跨域外键 `customerId` / `sku` / `invoiceId`，新增 `OrderListItem`（窄列表项）、`StockInfo`，`OrderDataSource` 增加 `checkStock`。
- `datasource.ts`（mock）：种子订单补全 `customerId/sku/invoiceId`；`listOrders` 只返回 `OrderListItem`；新增库存快照 `STOCK` 与 `checkStock`。
- `datasource.mssql.ts`：新增 `biz_stock` 表与种子；`listOrders` 窄化为 `id/title/status/amount`；`getOrder` 返回完整外键；`createOrder` 写入 `customer_id/sku`；新增 `checkStock`。
- `index.ts`：
  - `query_user_orders` 收窄为列表字段（不含外键，逼出详情调用）。
  - `query_order_detail` 返回完整 `customerId/sku/invoiceId`，可作为下钻入口。
  - 删除永不调用的 `list_order_statuses`（枚举已写在前者的 `parameters.status.enum`）。
  - 新增 `check_order_fulfillable`：内部「查订单 → 查库存」两步链，演示多步调用。
  - `create_order` 支持 `customerId/sku`。

> 效果：模型拿到订单后可经 `query_user_profile(customerId)`、`query_inventory(sku)` 继续下钻，
> 不再「只能调一次」。

### 2. 7 个 Bundle 的 resolveTenant 硬化并统一
- 原来 7 份实现不一致（`biz-order`/`biz-ticket` 有 `trim`；其余 4 个无 `trim`、无空值判断；且演示变量在生产也会被静默接受）。
- 现在统一为同一份语义：**演示环境变量（`ORDER_TENANT` 等）仅在 `NODE_ENV=development` 允许；生产环境误设则硬失败**，杜绝跨租户泄露。
- 涉及：`biz-order`(内联已含)、`biz-invoice`、`biz-user`、`biz-ticket`、`biz-knowledge`、`biz-inventory`。

### 3. 删除 biz-meeting 僵尸包
- 其 `package.json` 的 name 仍是 `@my-company/biz-user`，无 `src/`，不在任何 profile，且与 `biz-user` 重名。直接删除整个目录。

### 4. 修复 biz-ticket（原本根本编译不过）
- `index.ts` 引用了未定义的 `STATUSES` / `PRIORITIES` → 补齐常量。
- `datasource.mssql.ts` 是 `biz-user` 的整段复制（`UserDataSource` / `SqlServerUserDataSource` / `biz_users` 表）→ 重写为真正的 `SqlServerTicketDataSource`（`biz_tickets` 表 + 状态机校验复用 `canTransition`）。

## 二、跨包去重方案（已就绪，待 pnpm 落地）

新增包 `@my-company/biz-shared`（`enterprise/packages/private-bundles/biz-shared`，已编译通过）：

- `resolveTenant(exec, envVar)`：多租户隔离唯一入口（单一事实来源）。
- `TenantTableBase`：泛型 MSSQL 租户表基类，封装连接池 / 惰性建表 / 参数化执行 / `tenant = @tenant` 片段，消除各 `datasource.mssql.ts` 重复的 ~30 行样板。
- `generateBusinessId(prefix)` / `mapMssqlError(e, idLabel)`：通用工具。

**为何未硬连线**：当前环境没有 `pnpm`，无法把新包链接进 7 个 bundle 的 `node_modules`，
若强行 `import '@my-company/biz-shared'` 会导致编译/运行失败。因此 7 个 bundle 暂保留
「内容一致」的内联 `resolveTenant`，待 `pnpm install` 后再切换为共享实现。

**迁移步骤（执 pnpm install 后）**：
1. 各 bundle 的 `package.json` 增加 `"@my-company/biz-shared": "workspace:^"`。
2. 删除各 bundle 内联的 `resolveTenant`，改为 `import { resolveTenant } from '@my-company/biz-shared'`，
   调用点改为 `resolveTenant(exec, '<DOMAIN>_TENANT')`。
3. 各 `SqlServer*DataSource` 改为 `extends TenantTableBase`，删掉重复的 `getPool/ensureSchema` 样板，
   仅保留本表建表 SQL 与列映射。

## 三、验证状态

| 包 | 编译 | 备注 |
|---|---|---|
| biz-order | ✅ | 工具/模型重做 |
| biz-invoice | ✅ | resolveTenant 硬化 |
| biz-user | ✅ | resolveTenant 硬化 |
| biz-knowledge | ✅ | resolveTenant 硬化 |
| biz-inventory | ✅ | resolveTenant 硬化 |
| biz-ticket | ✅ | 修复后编译通过（此前损坏） |
| biz-shared | ✅ | 新建共享包，已编译 |
| biz-meeting | 🗑 | 已删除 |

> 注：biz-ticket 与 biz-shared 在本环境因 `node_modules` 未由 pnpm 链接，编译时借助临时
> `tsconfig.check.json`（paths 指向已链接的 `biz-order/node_modules`）做类型校验，校验后已删除该临时文件。
