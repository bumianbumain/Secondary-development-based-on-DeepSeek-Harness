/**
 * @my-company/biz-shared — 企业业务 Bundle 共享内核（单一事实来源）
 *
 * 抽离 7 个业务 Bundle 中彼此复制、且安全关键的逻辑，成为唯一实现：
 *   - resolveTenant：多租户隔离唯一入口（生产环境拒绝演示变量旁路）
 *   - TenantTableBase：泛型 MSSQL 租户表基类（连接池 / 惰性建表 / 参数化执行 / 租户过滤片段）
 *   - generateBusinessId / mapMssqlError：通用工具
 *
 * 迁移方式（待 pnpm install 后生效）：
 *   1. 在业务 Bundle 的 package.json 增加 "@my-company/biz-shared": "workspace:^"
 *   2. 执行 pnpm install（把本包链接进 node_modules）
 *   3. 删除各 bundle 内联的 resolveTenant，改为 `import { resolveTenant } from '@my-company/biz-shared'`
 *      （调用点改为 resolveTenant(exec, 'ORDER_TENANT') 形式，传入各自的环境变量名）
 *   4. 各 datasource.mssql.ts 的 SqlServer*DataSource 改为继承 TenantTableBase，
 *      删掉重复的 getPool/ensureSchema 样板，仅保留本表的建表 SQL 与列映射。
 *
 * 本包不依赖 @deepseek-ai/*，仅依赖 mssql，因此可独立编译验证。
 */

import mssql from 'mssql'

/** 进程内单例连接池缓存：同一连接串只建一个池，跨 Bundle 共享，为跨表事务（共享连接）铺路。 */
const sharedPools = new Map<string, Promise<mssql.ConnectionPool>>()

/** 按连接串取得（或惰性创建）进程内共享连接池；同一连接串全局复用同一池。 */
export function getSharedPool(connString: string): Promise<mssql.ConnectionPool> {
  if (!connString) throw new Error('数据库连接串未配置，无法连接 SQL Server')
  const cached = sharedPools.get(connString)
  if (cached) return cached
  const poolPromise = new mssql.ConnectionPool(connString).connect()
  sharedPools.set(connString, poolPromise)
  // 连接失败时清缓存，允许后续调用重试；不吞掉原 promise 的 rejection（调用方自行 await 处理）
  poolPromise.catch(() => {
    sharedPools.delete(connString)
  })
  return poolPromise
}

/** 与 @deepseek-ai/dsh-tools 的 ToolRunContext 结构兼容的最小子集（无需引入核心包）。 */
export interface ToolRunContextLike {
  agent?: { session?: { id?: string } }
}

/**
 * 从执行上下文解析租户（集中单一实现，杜绝 7 份各自漂移）。
 *
 * - 默认严格按会话隔离（`exec.agent.session.id`）；无会话（如 CLI 冒烟测试）回退 'demo'。
 * - 演示开关（envVar，如 ORDER_TENANT）仅在开发环境（NODE_ENV=development）允许，
 *   把所有会话固定到同一租户，便于在 UI 里直接看到种子数据。
 * - 生产/多租户环境若误设该变量，直接硬失败而非静默旁路隔离——防止跨租户泄露。
 */
export function resolveTenant(exec: ToolRunContextLike, envVar: string): string {
  const forced = process.env[envVar]
  if (forced && forced.trim()) {
    if (process.env.NODE_ENV === 'development') return forced.trim()
    throw new Error(
      `${envVar} 仅在开发环境(NODE_ENV=development)允许用于演示固定租户；`
      + '当前环境已拒绝该覆盖以防止跨租户泄露。请移除该变量以恢复按会话隔离。',
    )
  }
  return exec.agent?.session?.id ?? 'demo'
}

/** 生成形如 PREFIX-20260903-A3F7 的业务单号。 */
export function generateBusinessId(prefix: string): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${prefix}-${d}-${rnd}`
}

/** 将 SQL Server 错误转为友好提示（主键冲突 2627 / 2601 → 已存在）。 */
export function mapMssqlError(e: unknown, idLabel = '记录'): Error {
  const code = (e as { number?: number } | undefined)?.number
  if (code === 2627 || code === 2601) return new Error(`${idLabel}已存在，请换一个`)
  return e instanceof Error ? e : new Error(String(e))
}

/** 参数化输入：列名 + 值 + SQL 类型。 */
export interface SqlInput {
  name: string
  type: 'NVarChar' | 'Int' | 'Decimal'
  value: string | number
}

/**
 * 泛型 MSSQL 租户表基类：封装连接池、惰性建表、参数化执行与「tenant = @tenant」片段，
 * 各业务 Bundle 的 SqlServer*DataSource 继承它即可消除 datasource.mssql.ts 中重复的样板。
 */
export abstract class TenantTableBase {
  private pool: mssql.ConnectionPool | null = null

  constructor(protected readonly connString: string) {}

  /** 取得（惰性创建并建表）连接池。子类无需重复实现；底层池由 getSharedPool 全局共享。 */
  protected async getPool(): Promise<mssql.ConnectionPool> {
    if (!this.pool) {
      this.pool = await getSharedPool(this.connString)
      await this.ensureSchema()
    }
    return this.pool
  }

  /** 子类实现：惰性建表 + 种子数据（仅在首次连库时调用一次）。 */
  protected abstract ensureSchema(): Promise<void>

  /**
   * 执行参数化 SQL。bind 回调负责注入参数（含 tenant 片段由 tenantClause 提供）。
   * 返回 recordset 原始行，由子类 map 成业务模型。
   */
  protected async exec(sql: string, bind?: (req: mssql.Request) => void | Promise<void>): Promise<Record<string, unknown>[]> {
    const pool = await this.getPool()
    const req = pool.request()
    if (bind) await bind(req)
    const res = await req.query(sql)
    return res.recordset as Record<string, unknown>[]
  }

  /** 向 req 注入 @tenant 参数并返回 'tenant = @tenant' 片段，强制所有查询带租户过滤。 */
  protected tenantClause(req: mssql.Request, tenant: string): string {
    req.input('tenant', mssql.NVarChar, tenant)
    return 'tenant = @tenant'
  }
}

/** 事务内执行一条 SQL 后的完整结果。 */
export interface TxQueryResult {
  recordset: Record<string, unknown>[]
  rowsAffected: number[]
}

/**
 * 跨表事务作用域。MSSQL 事务必须绑在单条连接上；本类在共享连接池之上开启
 * mssql.Transaction，让一个业务动作内的多表写操作原子提交/回滚。
 * 领域服务用 TxContext.run 包裹「建单 + 扣库存 + 出发票」这类复合操作即可。
 */
export class TxContext {
  /**
   * 在事务作用域内执行 fn：拿共享池 → begin → fn → commit；任一步失败则 rollback 并重抛原始错误。
   */
  static async run<T>(
    connString: string,
    fn: (tx: mssql.Transaction) => Promise<T>,
  ): Promise<T> {
    if (!connString) throw new Error('数据库连接串未配置，无法开启事务')
    const pool = await getSharedPool(connString)
    const tx = new mssql.Transaction(pool)
    await tx.begin()
    try {
      const result = await fn(tx)
      await tx.commit()
      return result
    } catch (err) {
      try {
        await tx.rollback()
      } catch {
        // 回滚失败时保留原始错误
      }
      throw err
    }
  }

  /** 事务内参数化查询，返回 recordset。 */
  static async query(
    tx: mssql.Transaction,
    sql: string,
    bind?: (req: mssql.Request) => void | Promise<void>,
  ): Promise<Record<string, unknown>[]> {
    const { recordset } = await TxContext.execute(tx, sql, bind)
    return recordset
  }

  /** 事务内参数化 SQL，返回完整结果（recordset + rowsAffected，用于判断受影响行数）。 */
  static async execute(
    tx: mssql.Transaction,
    sql: string,
    bind?: (req: mssql.Request) => void | Promise<void>,
  ): Promise<TxQueryResult> {
    const req = new mssql.Request(tx)
    if (bind) await bind(req)
    const res = await req.query(sql)
    return {
      recordset: (res.recordset ?? []) as Record<string, unknown>[],
      rowsAffected: res.rowsAffected ?? [],
    }
  }
}

/** 下单演示入参。 */
export interface PlaceOrderInput {
  tenant: string
  customerId: string
  title: string
  amount: number
  sku: string
  qty: number
  taxRate?: number
  currency?: string
}

/** 下单演示：建订单 + 条件扣库存 + 生成发票，同一事务内原子执行（任一步失败整体回滚）。 */
export async function placeOrderDemo(
  connString: string,
  input: PlaceOrderInput,
): Promise<{ orderId: string; invoiceId: string }> {
  const taxRate = input.taxRate ?? 0.13
  const currency = input.currency ?? 'CNY'

  return TxContext.run(connString, async (tx) => {
    const orderId = generateBusinessId('ORD')
    const invoiceId = generateBusinessId('INV')

    // 1) 建订单
    await TxContext.query(
      tx,
      `INSERT INTO dbo.biz_orders
         (id, title, status, amount, created_at, tenant, customer_id, sku, invoice_id)
       VALUES (@id, @title, @status, @amount, @createdAt, @tenant, @customerId, @sku, @invoiceId)`,
      (req) => {
        req.input('id', mssql.NVarChar(64), orderId)
        req.input('title', mssql.NVarChar(200), input.title)
        req.input('status', mssql.NVarChar(32), 'pending')
        req.input('amount', mssql.Decimal(18, 2), input.amount)
        req.input('createdAt', mssql.DateTime, new Date())
        req.input('tenant', mssql.NVarChar(64), input.tenant)
        req.input('customerId', mssql.NVarChar(64), input.customerId)
        req.input('sku', mssql.NVarChar(64), input.sku)
        req.input('invoiceId', mssql.NVarChar(64), invoiceId)
      },
    )

    // 2) 条件扣减库存（库存不足时受影响行数为 0 → 抛错触发整体回滚）
    const updateRes = await TxContext.execute(
      tx,
      `UPDATE dbo.biz_inventory
          SET quantity = quantity - @qty
        WHERE sku = @sku AND tenant = @tenant AND quantity >= @qty`,
      (req) => {
        req.input('qty', mssql.Int, input.qty)
        req.input('sku', mssql.NVarChar(64), input.sku)
        req.input('tenant', mssql.NVarChar(64), input.tenant)
      },
    )
    const affectedRows = updateRes.rowsAffected[0] ?? 0
    if (affectedRows === 0) {
      throw new Error(`库存不足：sku=${input.sku} tenant=${input.tenant} 需要 ${input.qty}`)
    }

    // 3) 生成发票
    await TxContext.query(
      tx,
      `INSERT INTO dbo.biz_invoices
         (id, orderId, customerId, amount, taxRate, status, issuedAt, dueAt,
          paidAmount, paidAt, currency, lineItemsJson, tenant)
       VALUES (@id, @orderId, @customerId, @amount, @taxRate, @status, @issuedAt, @dueAt,
          @paidAmount, @paidAt, @currency, @lineItemsJson, @tenant)`,
      (req) => {
        req.input('id', mssql.NVarChar(64), invoiceId)
        req.input('orderId', mssql.NVarChar(64), orderId)
        req.input('customerId', mssql.NVarChar(64), input.customerId)
        req.input('amount', mssql.Decimal(18, 2), input.amount)
        req.input('taxRate', mssql.Decimal(5, 4), taxRate)
        req.input('status', mssql.NVarChar(32), 'unpaid')
        req.input('issuedAt', mssql.DateTime, new Date())
        req.input('dueAt', mssql.DateTime, new Date(Date.now() + 30 * 24 * 3600 * 1000))
        req.input('paidAmount', mssql.Decimal(18, 2), 0)
        req.input('paidAt', mssql.DateTime, null)
        req.input('currency', mssql.NVarChar(8), currency)
        req.input('lineItemsJson', mssql.NVarChar(mssql.MAX), JSON.stringify([{ sku: input.sku, qty: input.qty, amount: input.amount }]))
        req.input('tenant', mssql.NVarChar(64), input.tenant)
      },
    )

    return { orderId, invoiceId }
  })
}
