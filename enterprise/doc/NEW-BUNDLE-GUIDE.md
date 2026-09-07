# DSH 新业务 Bundle 从零搭建新手手册

> 面向：需要在 deepseek-harness 企业层新增一个业务模块（Bundle）的开发者。
> 本文以一个真实可运行的业务模块为蓝本，把「从零搭建 → 装配 → 验证 → 常见坑」讲透。
> 配套示例：`enterprise/packages/private-bundles/` 下的 `biz-order` / `biz-user` / `biz-inventory` / `biz-invoice` / `biz-knowledge` / `biz-ticket`，以及共享内核 `biz-shared`。

---

## 一、先理解：DSH 的「万物皆插件」是怎么落地的

DSH 核心（`apps/`、`packages/`）**不改一行**。业务能力以独立 npm 包（Bundle）挂在 `enterprise/packages/private-bundles/` 下，通过 **cordis 依赖注入**往同一个 `tools` 服务注册工具，再在 profile 的 `bundles` 清单里装配。

一个 Bundle 由 5 个文件构成，职责清晰分层：

| 文件 | 职责 |
|---|---|
| `types.ts` | 领域模型（纯数据形状，不碰数据源） |
| `datasource.mssql.ts` | SQL Server 实现（建表 + 参数化查询 + 增删改） |
| `datasource.ts` | 工厂（按环境变量返回数据源实例） |
| `index.ts` | 工具注册（把业务能力暴露给模型） |
| `cordis.patch.yml` | 装配补丁（声明包名/id/注入） |

---

## 二、目录结构总览

```
enterprise/packages/private-bundles/
├── biz-shared/                 # 共享内核（所有 bundle 复用）
│   └── src/index.ts            #   resolveTenant / getSharedPool / TxContext / TenantTableBase
└── biz-你的业务名/
    ├── package.json
    ├── tsconfig.json
    ├── cordis.patch.yml
    ├── src/
    │   ├── types.ts
    │   ├── datasource.mssql.ts
    │   ├── datasource.ts
    │   └── index.ts
    └── lib/                    # 编译产物（运行时加载的是这里）
```

---

## 三、分步搭建（以「员工/设备」业务 `biz-asset` 为例）

### 第 1 步：`package.json`

```json
{
  "name": "@my-company/biz-asset",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-tools": "*"
  },
  "dependencies": {
    "@my-company/biz-shared": "*",
    "mssql": "^11.0.0"
  }
}
```

> 注意：`type: module` 意味着 ESM，**相对 import 必须带 `.js` 后缀**（如 `from './types.js'`）。

### 第 2 步：`types.ts` —— 领域模型

```ts
export type AssetStatus = 'in_use' | 'idle' | 'repairing' | 'retired'

export interface Asset {
  id: string
  name: string
  status: AssetStatus
  /** 归属租户（多租户隔离单元） */
  tenant: string
}

export interface CreateAssetInput {
  id?: string
  name: string
  status?: AssetStatus
}

/** 数据源契约：业务工具只依赖这个接口，不依赖具体实现 */
export interface AssetDataSource {
  listAssets(tenant: string, limit?: number): Promise<Asset[]>
  createAsset(tenant: string, input: CreateAssetInput): Promise<Asset>
}
```

**设计要点**：
- 模型字段要能支撑「下钻」（加外键），否则工具只能被调一次。
- 列表与详情字段刻意分层：列表给窄字段，详情给全字段，制造信息增量。

### 第 3 步：`datasource.mssql.ts` —— SQL Server 实现

```ts
import mssql from 'mssql'
import { generateBusinessId, getSharedPool } from '@my-company/biz-shared'
import type { Asset, AssetDataSource, AssetStatus, CreateAssetInput } from './types'

const ALL_STATUSES: AssetStatus[] = ['in_use', 'idle', 'repairing', 'retired']
const CONN = process.env.ASSET_DB_MSSQL!

/** 建表（不存在才建）。注意：只建不迁，改字段要用 ALTER 或重建。 */
async function ensureSchema(pool: mssql.ConnectionPool): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID('dbo.biz_assets', 'U') IS NULL
    CREATE TABLE dbo.biz_assets (
      id      nvarchar(64)  NOT NULL PRIMARY KEY,
      name    nvarchar(200) NOT NULL,
      status  nvarchar(32)  NOT NULL,
      tenant  nvarchar(64)  NOT NULL
    );
  `)
}

export class SqlServerAssetDataSource implements AssetDataSource {
  async listAssets(tenant: string, limit = 10): Promise<Asset[]> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('limit', mssql.Int, Math.max(1, limit))
      .query(`SELECT id, name, status, tenant FROM dbo.biz_assets
              WHERE tenant = @tenant ORDER BY id
              OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`)
    return recordset.map(r => ({
      id: String(r.id), name: String(r.name),
      status: String(r.status) as AssetStatus, tenant: String(r.tenant),
    }))
  }

  async createAsset(tenant: string, input: CreateAssetInput): Promise<Asset> {
    const name = String(input.name ?? '').trim()
    if (!name) throw new Error('设备名称不能为空')
    const status = (input.status ?? 'idle') as AssetStatus
    if (!ALL_STATUSES.includes(status)) throw new Error(`不支持的设备状态：${status}`)

    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const id = input.id?.trim() || generateBusinessId('AST')
    await pool.request()
      .input('id', mssql.NVarChar, id)
      .input('name', mssql.NVarChar, name)
      .input('status', mssql.NVarChar, status)
      .input('tenant', mssql.NVarChar, tenant)
      .query('INSERT INTO dbo.biz_assets (id, name, status, tenant) VALUES (@id, @name, @status, @tenant)')
    return { id, name, status, tenant }
  }
}
```

### 第 4 步：`datasource.ts` —— 工厂

```ts
import type { Asset, AssetDataSource, AssetStatus, CreateAssetInput } from './types'
import { SqlServerAssetDataSource } from './datasource.mssql.js'

let instance: AssetDataSource | null = null

export function getAssetDataSource(): AssetDataSource {
  if (instance) return instance
  const conn = process.env.ASSET_DB_MSSQL
  if (!conn) throw new Error('ASSET_DB_MSSQL 未配置，无法连接 SQL Server')
  instance = new SqlServerAssetDataSource(conn)
  return instance
}
```

### 第 5 步：`index.ts` —— 注册工具

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { resolveTenant } from '@my-company/biz-shared'
import { getAssetDataSource } from './datasource.js'

export const name = 'biz-asset'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.effect(() => () => {})  // 资源生命周期登记（连接等）

  const ds = getAssetDataSource()

  ctx.tools.register(defineTool({
    name: 'query_assets',
    description: '查询当前租户下的设备列表。当用户询问设备/资产清单时使用。',
    parameters: {
      limit: { type: 'number', description: '返回条数上限，默认 10。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'ASSET_TENANT')  // 多租户解析
      const assets = await ds.listAssets(tenant, args.limit)
      return { tenant, count: assets.length, assets } as any
    },
  }))
}
```

### 第 6 步：`cordis.patch.yml`

```yaml
# 包名、id、name 三者必须一致（这是最常出错的点）
- name: biz-asset
  id: biz-asset
  apply: biz-asset
```

### 第 7 步：`tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2024"],
    "outDir": "lib",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

---

## 四、装配到 profile

编辑 `~/.dsh/profiles/enterprise/package.json`，在 `dsh.profile.bundles` 数组里加：

```json
"@my-company/biz-asset"
```

**无 pnpm 环境的手动链接**（本机无 pnpm，无法 `pnpm install` 建软链，需手动）：
1. profile 运行期加载：`~/.dsh/profiles/enterprise/node_modules/@my-company/biz-asset` → 软链到包目录。
2. 编译期解析：`biz-asset/node_modules/@my-company/biz-shared`、`mssql`、`@types/mssql` → 软链到真实目录。

---

## 五、编译验证

```bash
# 根目录（typescript 在仓库根 node_modules）
node node_modules/typescript/bin/tsc -p enterprise/packages/private-bundles/biz-asset/tsconfig.json
```

编译成功后 `lib/` 生成 `index.js`，profile 侧 `require` 能加载即装配成功。

---

## 六、启动脚本 + 环境变量

在 `enterprise/start-web-sql.sh` 加：

```bash
export NODE_ENV="${NODE_ENV:-development}"        # 允许演示变量固定租户
export ASSET_DB_MSSQL="${ASSET_DB_MSSQL:-$ORDER_DB_MSSQL}"
export ASSET_TENANT="${ASSET_TENANT:-demo}"
```

> **关键坑**：`resolveTenant` 的演示变量（`ASSET_TENANT` 等）只在 `NODE_ENV=development` 生效。设了演示变量就**必须**配套设 `NODE_ENV=development`，否则启动即报「仅在开发环境允许」。

---

## 七、核心设计原则（本仓库踩坑总结，务必遵守）

1. **幂等键**：所有 `create_*` 都要先查重（用户按 email、库存按 SKU、发票按 orderId），数据库层再加唯一索引兜底。
2. **成对接口**：`create` 配 `update`、入库（`restock`）配出库（`deduct`）、开票配改票。缺一边业务必卡。
3. **状态机**：有状态流转的实体必须有 `update_xxx_status`，否则状态锁死在创建时。
4. **多租户隔离**：`resolveTenant` 用 `@my-company/biz-shared` 的单源实现，绝不各 bundle 内联一份。所有查询强制 `tenant = @tenant`。
5. **连接池共享**：用 `getSharedPool(connString)`，同一连接串全局复用同一池，这是跨表事务（`TxContext`）的前提。
6. **ESM `.js` 后缀**：相对 import 的值导入必须 `./types.js`，`import type` 可以不带（编译即擦除）。
7. **出库条件扣减**：`UPDATE ... SET quantity = quantity - @qty WHERE quantity >= @qty`，用 `rowsAffected` 判断库存是否充足，避免扣成负数。
8. **`defineTool` 的 args 类型**：属性是 `string | undefined`，传给必填 string 字段要 `String(args.xxx ?? '')` 包裹。

---

## 八、常见坑速查

| 症状 | 根因 | 解法 |
|---|---|---|
| 启动报「X_TENANT 仅在开发环境允许」 | 设了演示变量但没设 `NODE_ENV=development` | 启动脚本补 `NODE_ENV=development` |
| `Cannot find module './types'` | 值 import 缺 `.js` 后缀 | 改成 `./types.js` |
| 编译通过但运行时查不到新工具 | web 进程没重启 | 杀旧进程 + 重启 |
| 重复数据（同名用户/重复订单） | `create_*` 无幂等键 | 加查重 + 唯一索引 |
| 表结构对不上代码 | `ensureSchema` 只建不迁 | 用 ALTER 补列或重建表 |
| 跨表操作部分成功 | 无事务 | 用 `TxContext.run` 包住多表写 |

---

## 九、从零到跑通的最短路径（TL;DR）

1. `biz-shared` 已提供 `resolveTenant` / `getSharedPool` / `generateBusinessId` / `TxContext`，**直接 import，不要重复造轮子**。
2. 复制一个现有 bundle（如 `biz-inventory`）的 5 文件骨架，**改全「目录名 / package name / cordis.patch.yml 的 id·name」三处**（最易漏）。
3. 写 `types.ts` 模型 → `datasource.mssql.ts` 建表+增删改 → `index.ts` 注册工具。
4. 编译 → 加进 profile bundles → 启动脚本补连接串 → 重启 web → 用工具实测一轮。
