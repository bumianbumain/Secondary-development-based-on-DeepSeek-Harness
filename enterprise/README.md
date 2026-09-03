# enterprise/ — 你的企业级扩展层（私有仓库骨架）

> **想再新增一个插件/Bundle？** 直接照 `docs/ADD-A-PLUGIN.md` 的「复制→改名→填充」七步走，
> 与现有 8 个包同构、同门禁、同验收（三类包位模板都在本文目录树里）。

本目录是你建议书 §3.1 的落地骨架：**与 upstream fork 解耦的私有扩展层**。
它放在 fork 内只是为了方便你本地开发；正式生产时应抽成独立私有仓库（`origin`），fork 仅做同步。

```
enterprise/
├── packages/
│   ├── private-bundles/        # 第2层：业务 Bundle（工具/技能）
│   │   └── biz-order/          #   示例：订单查询 Bundle（可跑）
│   ├── private-overrides/      # 第3层：核心行为覆盖（替换 agent loop / 提示词拦截）
│   │   └── system-prompt-hook/
│   └── private-ui/             # 第4层：UI 定制（侧边栏品牌、工作区模板）
│       └── sidebar-brand/
├── profiles/                   # Profile 装配（组合上面的层）
│   └── enterprise.cordis.yml
├── patches/                    # Patch 覆盖层
│   └── base-override.cordis.yml
├── configs/                    # 环境配置（dev/staging/prod）
│   └── dev/models.yml
└── scripts/
    └── sync-upstream.sh        # 上游同步脚本
```

## 接入 fork 的两种方式

**方式 A（推荐开发期）：并入 fork 的 workspace**
在 `D:/DSH/deepseek-harness/pnpm-workspace.yaml` 的 `packages:` 下加一行：
```yaml
packages:
  # ... 原有 ...
  - enterprise/packages/*/*
```
然后 `pnpm install`，你的 `@my-company/*` 包即可被 `workspace:^` 解析。

**方式 B（生产期）：私有 npm**
把 `private-bundles/*` 发布到 Verdaccio / 阿里云 NPM，在 fork 里 `pnpm add @my-company/biz-order`。

## 运行

```sh
# 从 fork 根目录
bash enterprise/run-web-env.sh dev --dump     # 免启动预览 dev 组合配置树
bash enterprise/run-web-env.sh dev            # 启动 dev web（3080，SQL 数据源，推荐入口）
bash enterprise/run-web-env.sh staging --bg   # staging(3081) / prod(3082) 同理；多环境详见文末 P3(续2)
dsh --profile web --dump-config               # 审计默认 web profile 插件树
```

（早期入口 `start-web-sql.sh` 仍可用但已被 `run-web-env.sh dev` 取代——后者把数据源变量、
overlay、日志统一进多环境层；历史归档 overlay 见 `profiles/enterprise.cordis.yml`。）

## 同步上游

```sh
bash enterprise/scripts/sync-upstream.sh
```

> 原则：本目录永不修改 `packages/*` 与 `vendor/`。所有定制只通过 Bundle / Patch / Profile 表达。

---

## 业务 Bundle 接入真实 SQL Server（已验证打通）

每个业务 Bundle 的所有数据访问都经由自己的数据源工厂，按环境变量切换实现，**业务工具代码零改动**。
已用同一套样板接通的 Bundle：

| Bundle | 工厂 | 数据源切换变量 | SQL 实现 | 演示租户开关 |
| --- | --- | --- | --- | --- |
| `biz-order` | `getOrderDataSource()` | `ORDER_DATASOURCE` | `SqlServerOrderDataSource`（`ORDER_DB_MSSQL`） | `ORDER_TENANT` |
| `biz-user` | `getUserDataSource()` | `USER_DATASOURCE` | `SqlServerUserDataSource`（`USER_DB_MSSQL`） | `USER_TENANT` |
| `biz-knowledge` | `getKnowledgeDataSource()` | `KNOWLEDGE_DATASOURCE` | `SqlServerKnowledgeDataSource`（`KNOWLEDGE_DB_MSSQL`） | `KNOWLEDGE_TENANT` |
| `biz-invoice` | `getInvoiceDataSource()` | `INVOICE_DATASOURCE` | `SqlServerInvoiceDataSource`（`INVOICE_DB_MSSQL`） | `INVOICE_TENANT` |
| `biz-inventory` | `getInventoryDataSource()` | `INVENTORY_DATASOURCE` | `SqlServerInventoryDataSource`（`INVENTORY_DB_MSSQL`） | `INVENTORY_TENANT` |

数据源实现模式（`src/datasource.mssql.ts`）：惰性建连 → `ensureSchema()` 自动建表（不存在才建）并 seed demo 种子 → 参数化多租户查询。列表类用 `OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY` 分页（T-SQL 的 `FETCH` 后必须跟 `ONLY`），或用 `SELECT TOP (n)`（biz-knowledge）。

### 启动

```sh
bash enterprise/start-web-sql.sh     # 以 SQL 数据源常驻启动（日志 dsh-web-sql.log，含 biz-order+biz-user+biz-knowledge+biz-invoice+biz-inventory）
bash enterprise/start-web.sh         # 以内存 mock 启动（日志 dsh-web.log）
```

等价的手工命令（一个 Bundle 一组环境变量，可同时启用多个）：

```sh
export ORDER_DATASOURCE=mssql ORDER_DB_MSSQL="Server=localhost,1433;Database=DSH;User Id=sa;Password=<密码>;TrustServerCertificate=true;Encrypt=true;" ORDER_TENANT=demo
export USER_DATASOURCE=mssql USER_DB_MSSQL="$ORDER_DB_MSSQL" USER_TENANT=demo
export KNOWLEDGE_DATASOURCE=mssql KNOWLEDGE_DB_MSSQL="$ORDER_DB_MSSQL" KNOWLEDGE_TENANT=demo
export INVOICE_DATASOURCE=mssql INVOICE_DB_MSSQL="$ORDER_DB_MSSQL" INVOICE_TENANT=demo
export INVENTORY_DATASOURCE=mssql INVENTORY_DB_MSSQL="$ORDER_DB_MSSQL" INVENTORY_TENANT=demo
node --import tsx/esm apps/cli/src/bin.ts --profile enterprise --no-open
```

> `TrustServerCertificate=true` **必需**：Express 默认用自签证书，不信任会导致 TLS 握手失败。
> 连接串务必带 `Database=DSH`，否则表会建到 `master` 系统库里。
> 首次查询时 `ensureSchema()` 自动建表（`dbo.biz_orders` / `dbo.biz_users`）并写入演示种子数据。
> 当前 `DSH` 库内：`biz_orders`(8 行) + `biz_users`(5 行，含演示期由 LLM 通过 `create_user` 写入的用户) + `biz_knowledge`(4 篇) + `biz_invoices`(4 张) + `biz_inventory`(4 条)。

### 环境变量（biz-order / biz-user 为同一模式的实例）

| 变量 | 作用 |
| --- | --- |
| `ORDER_DATASOURCE=mssql` | biz-order 切到 SQL Server 实现（同理 `USER_DATASOURCE`/`KNOWLEDGE_DATASOURCE`/`INVOICE_DATASOURCE`/`INVENTORY_DATASOURCE` 给其余 Bundle） |
| `ORDER_DB_MSSQL` / `USER_DB_MSSQL` / `KNOWLEDGE_DB_MSSQL` / `INVOICE_DB_MSSQL` / `INVENTORY_DB_MSSQL` | 各自连接串（含 `Database`、`TrustServerCertificate=true`） |
| `ORDER_TENANT` / `USER_TENANT` / `KNOWLEDGE_TENANT` / `INVOICE_TENANT` / `INVENTORY_TENANT` | **演示开关**：把所有会话固定到指定租户（如 `demo`），便于在 UI 里看到种子数据。**不设**该变量时按 `session.id` 严格隔离，这才是生产语义。查询本身始终带 `tenant` 过滤，隔离不受影响。 |

### SQL Server 侧的必要配置

新装的 SQL Server 默认**连不上**，必须做三件事（以命名实例 `SQLEXPRESS` 为例，注册表路径按实例名替换）：

1. **启用 TCP/IP**：`HKLM\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL17.SQLEXPRESS\MSSQLServer\SuperSocketNetLib\Tcp` 的 `Enabled` 由 `0` 改 `1`。
   —— `mssql`/tedious 只支持 TCP，**不支持命名管道**，所以只开 Named Pipes 的 LocalDB/默认实例必然连不上。
2. **设静态端口**：`IPAll\TcpPort=1433`，并清空 `TcpDynamicPorts`（动态端口客户端无法稳定连接）。
3. **开混合认证**：`...\MSSQLServer\LoginMode` 改 `2`，并 `ALTER LOGIN sa ENABLE; ALTER LOGIN sa WITH PASSWORD='...'`。

改完 `Restart-Service 'MSSQL$SQLEXPRESS'`。

> ⚠️ 排查提示：`ERRORLOG` 是 **UTF-16 编码**，`grep`/普通读取会当成二进制读不到内容。
> 用 PowerShell `Get-Content -Encoding Unicode` 才能看到 `Authentication mode is WINDOWS-ONLY`、监听端口等关键行。
> 另外 tedious 在本环境**取不到 SSPI 登录令牌**（报“用户 '' 登录失败”），所以 Node 侧只能用 `sa`/SQL 账号，不能用 Windows 身份验证。

### 验证脚本

```sh
# biz-order 数据源层 16 项断言（建连建表、种子、租户隔离、越权取单、过滤、limit、注入防护）
cd enterprise/packages/private-bundles/biz-order
export ORDER_DATASOURCE=mssql ORDER_DB_MSSQL="..." ORDER_TENANT=demo
node probe-e2e.mjs
node verify-tool.mjs   # 工具层：query_user_orders / query_order_detail / list_order_statuses

# biz-user 数据源层 31 项断言（同套覆盖 + roles 数组往返 + createUser 写入链路：全局唯一 ID、指定 ID、默认值、持久化、写入隔离、非法输入、主键冲突友好报错、注入防护）
cd enterprise/packages/private-bundles/biz-user
export USER_DATASOURCE=mssql USER_DB_MSSQL="..." USER_TENANT=demo
node tools/verify-user-e2e.mjs

# biz-knowledge 数据源层 25 项断言（同套覆盖 + tags 数组往返、中文内容、category/tag/keyword 组合过滤、listTags 去重）
cd enterprise/packages/private-bundles/biz-knowledge
export KNOWLEDGE_DATASOURCE=mssql KNOWLEDGE_DB_MSSQL="..." KNOWLEDGE_TENANT=demo
node tools/verify-knowledge-e2e.mjs

# biz-invoice 数据源层 22 项断言（同套覆盖 + 金额/税率数字类型、orderId 跨 Bundle 关联过滤、status+orderId 组合）
cd enterprise/packages/private-bundles/biz-invoice
export INVOICE_DATASOURCE=mssql INVOICE_DB_MSSQL="..." INVOICE_TENANT=demo
node tools/verify-invoice-e2e.mjs

# biz-inventory 数据源层 25 项断言（同套覆盖 + warehouse 中文过滤、getItem 按 SKU/ID 双路径、数量数字、listWarehouses 去重）
cd enterprise/packages/private-bundles/biz-inventory
export INVENTORY_DATASOURCE=mssql INVENTORY_DB_MSSQL="..." INVENTORY_TENANT=demo
node tools/verify-inventory-e2e.mjs
```

### 数据库看板（浏览器查看数据）

```sh
bash enterprise/start-db-board.sh     # → http://127.0.0.1:3099
PORT=4000 bash enterprise/start-db-board.sh   # 换端口
```

左侧列出库内所有表及行数（`biz_orders` / `biz_users` / `biz_knowledge` / `biz_invoices` / `biz_inventory`），可切「数据 / 表结构 / SQL 查询」三页；SQL 页可自定义查询。

**只读保证**：服务端仅放行单条 `SELECT` / `WITH`，拦截 DROP/DELETE/UPDATE/EXEC 等关键字与多语句（含分号）；表名经 `QUOTENAME` 处理防拼接注入；服务只监听 `127.0.0.1`。冒烟测试 `node tools/smoke-board.mjs`（6/6，含三项安全拦截断言）。

无浏览器的智能体链路验证（真实 LLM 自主调用工具，同 profile 可同时挂多个 Bundle）：

```sh
dsh --profile enterprise-headless "查一下我名下有哪些订单"      # biz-order → SQL Server
dsh --profile enterprise-headless "有哪些管理员用户？"           # biz-user 读 → SQL Server
dsh --profile enterprise-headless "新增用户：王芳 wangfang@demo.com，角色 finance"  # biz-user 写 → SQL Server（create_user）
dsh --profile enterprise-headless "搜知识库里订单发货相关文档"   # biz-knowledge → SQL Server
dsh --profile enterprise-headless "有哪些已付款发票？"           # biz-invoice → SQL Server
dsh --profile enterprise-headless "哪些库存不足？"               # biz-inventory → SQL Server
# 该 profile 位于 $DSH_HOME/profiles/enterprise-headless，栈为 dsh-base + dsh-headless + 五个 biz-* 业务 Bundle
```

## P3：UI 与行为定制（system-prompt-hook 系统提示词覆盖，已验证）

第 3 层「核心行为覆盖」落在 `packages/private-overrides/`，样板为 **system-prompt-hook**：
不改核心源码、也不替换 deployment persona，而是以「独立覆盖段 + assemble 收尾钩子」
把企业行为规则（多租户隔离 + 强制工具优先）钉进每次系统提示词组装结果。

- 机制一（声明式）：`ctx.systemPrompt.section()` 注入 `enterprise:policy` 段，落位可调
  `first / before-persona / after-persona / complete`（complete = 整体接管系统提示词）。
  注意不能占用 `deployment:persona` 槽（已被 dsh-system-prompt 服务注册，同名会 throw）。
- 机制二（命令式）：`system-prompt/assemble` waterfall 链尾 `await next()` 拿到上游改写
  完成后的权威结果，企业段不在场就放回（guard）——上游作用域无法静默清掉企业覆盖。
- 位置：`packages/private-overrides/system-prompt-hook/`；`inject = ['systemPrompt']`。

配置（插件行由 Bundle 自带 `cordis.patch.yml` 插入；调参走部署 overlay，勿改 patch）：

```yaml
# enterprise/env/<env>.cordis.yml（dev/staging/prod 各一份；多环境隔离见下节）
- id: system-prompt-hook
  config:
    text: "自定义企业覆盖文案（缺省用内置默认）"
    position: after-persona        # first | before-persona | after-persona | complete
    enforceTools: true             # 追加「先工具后回答」硬约束
    guard: true                    # 上游删除企业段时兜底放回
    debug: true                    # 每次组装打印 section 清单到服务日志
```

验证（不起 LLM，直接装配真实 cordis + SystemPrompt 服务断言组装结果）：

```sh
cd enterprise/packages/private-overrides/system-prompt-hook
node tools/verify-assemble.mjs     # 17/17：默认注入 / 四档落位 / complete 整体接管 / guard 兜底 / 关闭对照 / 空 persona / 自定义文案
```

两个 profile 均已挂载 `@my-company/system-prompt-hook`；web 启动时 Bundle patch 正常加载。
**观察覆盖生效**：dev overlay 已开 `debug: true`（见下节多环境层），在 UI(3080) 发任意一条
消息后，服务日志（`dsh-web-dev.log`）会出现
`[system-prompt-hook] assemble -> sections: harness:identity(...), deployment:persona(...), enterprise:policy(...), ...`。

## P3（续）：UI 品牌定制（sidebar-brand 侧边栏 Logo/产品名，已验证）

第 4 层「UI 定制」样板落在 `packages/private-ui/sidebar-brand/`：不改 upstream 前端源码，
通过官方 slot 注入把 shell 侧边栏的 Logo 与产品名整体替换成企业品牌。

- 槽位契约（`@deepseek-ai/dsh-client-ui-sidebar` 的 `contract/slots.ts`）：
  `sidebar.brand.mark`（收 `{size}`）与 `sidebar.brand.name`（不收 children）两个槽；
  shell 渲染时对 mark 有默认 fallback（FishLogo+本地构建名）。官方 `ui-brand-official`
  仅在 `DSH_CLIENT_BUILD_PROFILE==='official'` 才注册，因此企业包可无条件覆盖。
- 注册范式（照搬官方注册链）：`ctx.slots.inject('sidebar.brand.mark', () =>
  ctx.slots.inject('sidebar.brand.name', function* () { yield ctx.slots.register({name},
  Comp) ... }))`，见 `src/client/index.ts`；node 半（`src/index.ts`）是空 `apply`。
- 双半构建（`tsdown.config.ts`）：node 半 → `lib/index.js`（服务端 patch 用）；
  client 半 → `lib/client.js`（CJS 包裹在 `window.__ModuleLoader__.load({id, factory})`
  里，react / `@deepseek-ai/*` 全部 external，由 web 运行时的模块表解析）。
- 品牌定制点（`src/client/Brand.tsx` 顶部常量）：`ENTERPRISE_BRAND_GLYPH`（方块内的字，
  默认「智」）、`ENTERPRISE_PRODUCT_NAME`（默认「智能体中台」）、
  `ENTERPRISE_PRODUCT_SUB`（默认「ENTERPRISE AI PLATFORM」）；颜色全走 dsw design
  token，自动适配深浅主题。

接入步骤（其余 Bundle 同款）：

```sh
# 1) 构建双半
cd enterprise/packages/private-ui/sidebar-brand
node ../../../../node_modules/.pnpm/tsdown@0.22.2_oxc-resolver@_f113eb69000457c8d5954142d0822f52/node_modules/tsdown/dist/run.mjs
# 2) profile 声明（$DSH_HOME/profiles/enterprise/package.json 的 dsh.profile.bundles 追加）
#    "@my-company/sidebar-brand"，并软链该包到 profile 的 node_modules/@my-company/
```

浏览器侧实证（web 起在 3080 后，登录 cookie 认证下两条命令）：

```sh
# ① 模块图包含 @my-company/sidebar-brand（curl -N 连 /plugins/events SSE 后 grep id）
curl -N -H "Cookie: dsh-auth-..." http://127.0.0.1:3080/plugins/events | grep -o '"id":"[^"]*"'
# ② 按图中 url 拉 client.js，字节级确认品牌注册已下发
curl -H "Cookie: dsh-auth-..." 'http://127.0.0.1:3080/plugins/??@my-company/sidebar-brand/client.js&rev=<图中rev>'
#    → window.__ModuleLoader__.load({id:"@my-company/sidebar-brand", ...})，含 智能体中台 / sidebar.brand.mark / .name
```

验证结论：模块图共 48 项，`@my-company/sidebar-brand` 与 `@my-company/biz-plugins-panel`
并列在册，`inject` 与 package.json 的 `dsh.client.inject` 一致；下发脚本字节级含品牌注册
代码。仅 web（enterprise）profile 挂载本包（无头 profile 不加载 UI）。

## P3（续2）：多环境配置隔离（dev/staging/prod，已验证）

同一份代码、同一套 `enterprise` profile，三套环境差异全部收敛到 `enterprise/env/`：
**dev(3080, 本机库 DSH) / staging(3081, DSH_Staging) / prod(3082, DSH_Prod)**，
可同时启动互不干扰。差异切分与操作详见 `enterprise/env/README.md`；一页速览：

```sh
bash enterprise/run-web-env.sh dev                # 前台启动（Ctrl+C 停）
bash enterprise/run-web-env.sh staging --bg       # 后台启动，日志 dsh-web-staging.log
bash enterprise/run-web-env.sh prod --dump        # 免启动预览组合配置树（验证层叠）
```

差异层模型（利用 dsh 原生装载序：bundle patch → profile 自身 patch → home patch →
`--patch` overlay，后加载优先；`--patch` 可重复、`--dump-config` 免启动预览）：

| 文件 | 职责 | 示例 |
| --- | --- | --- |
| `env/<env>.env` | 环境变量（连接串/租户开关） | dev 连 `DSH`，staging 连 `DSH_Staging` |
| `env/common.cordis.yml` | 公共 overlay（企业 persona） | 每次启动恒加载 |
| `env/<env>.cordis.yml` | 环境差异 overlay | webserver port 3080/3081/3082；hook debug 开/开/关 |
| `run-web-env.sh` | 运行器：source `.env` → 组装两层 overlay → 启动/预览 | 校验环境名、`DSH_ENV=<env>` |

已实证：
- `--dump-config` 三环境各自呈现差异：webserver `127.0.0.1:3080/3081/3082`、
  `system-prompt-hook debug: true/true/false`、公共 persona 由 common 层注入；
- **多实例并存**：dev(3080) + staging(3081) + 数据库看板(3099) 三进程同时监听，
  staging 独立登录、client 模块图正常（overlay 端口覆盖默认端口生效）；
- 本机已建 `DSH_Staging` / `DSH_Prod` 空库（业务表与种子由 ensureSchema 首次连接自动建立）；
- 旧的 `enterprise/profiles/enterprise.cordis.yml` 已归档（等价内容迁移到 `env/`）。

生产隔离：另设 `DSH_HOME`（独立凭据/settings/profile）再跑
`DSH_HOME=/etc/dsh-prod bash enterprise/run-web-env.sh prod`；生产密码不写仓库，删
`prod.env` 对应行改由调用方 export（运行器 source 会覆盖同名继承变量）。

### 改源码后的必做步骤

**dsh 运行时加载的是编译产物 `lib/*.js`，不是 `src/*.ts`**。改完必须重新编译，否则仍跑旧代码：

```sh
cd enterprise/packages/private-bundles/biz-order            # 或 private-overrides/system-prompt-hook 等任一 Bundle
node <repo>/node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/bin/tsc -p tsconfig.json
```

（`tsc` 路径要用 Windows 绝对路径，Git Bash 的 `/d/...` 会被 node 误转成 `D:\d\...`。）

## P4：测试与验收（集成门禁 + 上游同步演练 + 部署文档，已验证）

对应建议书 P4（第 7~8 周）交付物与验收标准「1 天内完成 DSH 官方版本升级适配」。
三件套一键可跑，作为每次改动/升级的放行依据：

```bash
# ① 集成门禁：21 项断言（配置树/多环境差异/机制/5 数据源 e2e/Web 冒烟）
bash enterprise/tests/run-integration.sh            # 全量（需 SQL Server 1433）
bash enterprise/tests/run-integration.sh --quick    # 快速 13 项（跳过数据源套件）
# ② 上游同步演练：9 项断言（核心零改动预检 + 合成上游零冲突 + 违规被点名）
bash enterprise/scripts/upgrade-drill.sh
```

### ① run-integration.sh —— 单命令回归整个企业层

| 组 | 断言 |
|---|---|
| [1] 配置树/多环境 | dump 含 5 个 biz Bundle + system-prompt-hook；persona 由 common 注入；dev/staging/prod 的 port(3080/3081/3082) 与 hook debug(true/true/false) 差异 |
| [2] 机制 | system-prompt-hook verify-assemble 拼装断言 |
| [3] 数据源 e2e | biz-order probe/write、biz-user 31 项、biz-knowledge 25 项、biz-invoice 22 项、biz-inventory 25 项（真实 SQL Server + dev.env 连接串） |
| [4] Web 冒烟 | dev(3080) 登录换 cookie → `/plugins/events` SSE → 模块图含 `@my-company/sidebar-brand` 与 `@my-company/biz-plugins-panel` |

门禁前自动执行 **demo 夹具复位**（`biz-user/tools/reset-demo-fixture.mjs`）：
清除 LLM 实跑/历史手动运行在 demo 租户的残留行，保证「demo 恰好 4 条规范种子」这一
强不变量可复现；若种子本身缺失则报错暴露，不做静默修复。

实现要点（踩坑记录）：
- Git Bash 下原生 curl `-o /dev/null` 会写失败（rc=23）、SSE 常驻流 `-m` 超时（rc=28 属预期）：
  一律捕获到变量并 `|| true`，靠后续 grep 断言数据；
- `set -euo pipefail` 下命令替换失败会中断脚本：token/头/事件流取值均需容错。

### ② upgrade-drill.sh —— “上游发版 1 天内适配”的证据链

| 阶段 | 断言 |
|---|---|
| [1] 预检 | 双口径（已提交域 BASE..HEAD + 未提交工作区）证明核心源码零改动：非 enterprise/ 变更仅限瞬态清理、归档文档删除、`.gitignore/pnpm-workspace.yaml/pnpm-lock.yaml` |
| [2] 合成上游 | 在官方基线 `4e84901e64`（release/dsh-0.1.2-alpha.4 合并点）上用纯 plumbing 构造 v0.2.0-beta.1，bump 4 个核心 package.json，且不触碰 enterprise/ |
| [3] 干净升级 | `git merge-tree --write-tree`：本地分支 vs 合成上游 **rc=0 零冲突**，冲突清单不含 enterprise/ |
| [4] 违规被拦截 | 负例：本地若直接改核心 `apps/cli/package.json` → merge-tree rc≠0 且点名该文件 |
| [5] Runbook | 全绿后自动生成 `enterprise/docs/UPGRADE-RUNBOOK.md`（8 小时排期 + 验收清单 + 回滚预案） |

为什么升级几乎零成本：核心零改动 ⇒ 上游永不与企业层冲突；配置/数据在仓库之外
（`env/*.env` 注入），升级不触碰运行配置。→ 详见 `enterprise/docs/DEPLOYMENT.md`。

实现要点（踩坑记录）：
- 沙箱会 SIGTERM `git worktree add` 与「每行 spawn grep 的千次循环」：合成提交改走纯
  plumbing（`read-tree/update-index --cacheinfo/write-tree/commit-tree`，`GIT_INDEX_FILE`
  需 Windows 路径），逐行判定改 `[[ =~ ]]` 零子进程；
- 游离提交演练后可 `git prune` 回收（本仓库已清理）。

### 验收对照（建议书 6.3 质量验收标准）

| 验收项 | 状态 | 证据 |
|---|---|---|
| 插件树可正确加载（5 个业务 Bundle + UI/行为定制） | ✅ | run-integration [1][4] + `/plugins/events` 模块图 48 项含 @my-company/* |
| 数据源层集成可用（多租户隔离/中文/角色/注入防护） | ✅ | run-integration [3]：biz-* 共 100+ 项断言全绿 |
| 系统提示词行为覆盖生效 | ✅ | run-integration [2] verify-assemble |
| 多环境配置隔离（dev/staging/prod） | ✅ | run-integration [1]：port/debug/persona 三层差异逐条校验 |
| 部署可复制 | ✅ | `enterprise/docs/DEPLOYMENT.md`（矩阵/反代 TLS/数据初始化/回滚/凭据） |
| 官方版本升级 1 天内适配 | ✅ | `upgrade-drill.sh` 9 项全绿 + `UPGRADE-RUNBOOK.md`（2026-09-03 演练通过） |

> 一句话结论：**核心零改动 + 全量门禁 + 冲突预演 = 官方发版只需按 Runbook 走流程，
> 冲突与回归都被脚本挡在合并之前。**
