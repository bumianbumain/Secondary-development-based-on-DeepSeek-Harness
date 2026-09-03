/**
 * Microsoft SQL Server 订单数据源实现。
 *
 * 通过 mssql 驱动连接 SQL Server；连接串从环境变量 ORDER_DB_MSSQL 注入
 * （由启动进程传入，禁止硬编码凭据）。首次查询时惰性建连并初始化表结构
 * （biz_orders），若 demo 租户为空则写入种子数据，便于直接验证全链路。
 *
 * 该实现与 MockOrderDataSource 遵循同一个 OrderDataSource 契约，
 * 业务工具代码无需改动即可切换（工厂见 datasource.ts）。
 */

import mssql from 'mssql'
import type { CreateOrderInput, Order, OrderDataSource, OrderFilter, OrderStatus } from './types'

const ALL_STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'completed', 'cancelled']

const DEMO_SEED: Order[] = [
  { id: 'SO-1001', title: '企业版年费', status: 'paid', amount: 12000, createdAt: '2026-08-01', tenant: 'demo' },
  { id: 'SO-1002', title: '咨询实施服务', status: 'shipped', amount: 8000, createdAt: '2026-08-12', tenant: 'demo' },
  { id: 'SO-1003', title: '定制开发包', status: 'pending', amount: 25000, createdAt: '2026-08-20', tenant: 'demo' },
  { id: 'SO-1004', title: '增值运维包', status: 'completed', amount: 6000, createdAt: '2026-07-15', tenant: 'demo' },
]

export class SqlServerOrderDataSource implements OrderDataSource {
  private pool: mssql.ConnectionPool | null = null

  constructor(private readonly connString: string) {}

  private async getPool(): Promise<mssql.ConnectionPool> {
    if (!this.pool) {
      this.pool = new mssql.ConnectionPool(this.connString)
      await this.pool.connect()
      await this.ensureSchema()
    }
    return this.pool
  }

  private async ensureSchema(): Promise<void> {
    const pool = this.pool!
    await pool.request().query(`
      IF OBJECT_ID('dbo.biz_orders', 'U') IS NULL
      CREATE TABLE dbo.biz_orders (
        id         nvarchar(64)  NOT NULL PRIMARY KEY,
        title      nvarchar(256) NOT NULL,
        status     nvarchar(32)  NOT NULL,
        amount     decimal(18,2) NOT NULL,
        created_at nvarchar(32)  NOT NULL,
        tenant     nvarchar(128) NOT NULL
      );
    `)
    const { recordset } = await pool
      .request()
      .query("SELECT COUNT(*) AS c FROM dbo.biz_orders WHERE tenant = 'demo'")
    if (Number(recordset[0]?.c ?? 0) === 0) {
      for (const o of DEMO_SEED) {
        await pool
          .request()
          .input('id', mssql.NVarChar, o.id)
          .input('title', mssql.NVarChar, o.title)
          .input('status', mssql.NVarChar, o.status)
          .input('amount', mssql.Decimal(18, 2), o.amount)
          .input('created_at', mssql.NVarChar, o.createdAt)
          .input('tenant', mssql.NVarChar, o.tenant)
          .query(
            'INSERT INTO dbo.biz_orders (id, title, status, amount, created_at, tenant) VALUES (@id, @title, @status, @amount, @created_at, @tenant)',
          )
      }
    }
  }

  async listOrders(tenant: string, filter?: OrderFilter, limit = 10): Promise<Order[]> {
    const pool = await this.getPool()
    const req = pool.request().input('tenant', mssql.NVarChar, tenant)
    const clauses: string[] = ['tenant = @tenant']
    if (filter?.status) {
      req.input('status', mssql.NVarChar, filter.status)
      clauses.push('status = @status')
    }
    if (filter?.keyword) {
      req.input('kw', mssql.NVarChar, `%${filter.keyword}%`)
      clauses.push('(title LIKE @kw OR id LIKE @kw)')
    }
    req.input('limit', mssql.Int, Math.max(1, limit))
    const { recordset } = await req.query(
      `SELECT id, title, status, amount, created_at, tenant
       FROM dbo.biz_orders
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`,
    )
    return recordset.map(rowToOrder)
  }

  async getOrder(tenant: string, orderId: string): Promise<Order | null> {
    const pool = await this.getPool()
    const { recordset } = await pool
      .request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('id', mssql.NVarChar, orderId)
      .query(
        'SELECT id, title, status, amount, created_at, tenant FROM dbo.biz_orders WHERE tenant = @tenant AND id = @id',
      )
    return recordset[0] ? rowToOrder(recordset[0]) : null
  }

  async createOrder(tenant: string, input: CreateOrderInput): Promise<Order> {
    const pool = await this.getPool()
    const title = String(input.title ?? '').trim()
    if (!title) throw new Error('订单标题不能为空')
    const amount = Number(input.amount)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('订单金额必须是非负数')

    const status = (input.status ?? 'pending') as OrderStatus
    if (!ALL_STATUSES.includes(status)) throw new Error(`不支持的订单状态：${status}`)

    // 单号：调用方未指定则按「SO-日期-随机序号」生成，避免与既有数据撞号
    const id = input.id?.trim() || generateOrderId()
    const createdAt = new Date().toISOString().slice(0, 10)

    try {
      await pool
        .request()
        .input('id', mssql.NVarChar, id)
        .input('title', mssql.NVarChar, title)
        .input('status', mssql.NVarChar, status)
        .input('amount', mssql.Decimal(18, 2), amount)
        .input('created_at', mssql.NVarChar, createdAt)
        .input('tenant', mssql.NVarChar, tenant)
        .query(
          'INSERT INTO dbo.biz_orders (id, title, status, amount, created_at, tenant) VALUES (@id, @title, @status, @amount, @created_at, @tenant)',
        )
    } catch (e) {
      // SQL Server 主键冲突错误号 2627 / 2601
      const code = (e as { number?: number }).number
      if (code === 2627 || code === 2601) throw new Error(`订单号 ${id} 已存在，请换一个`)
      throw e
    }
    return { id, title, status, amount, createdAt, tenant }
  }

  listStatuses(): readonly OrderStatus[] {
    return ALL_STATUSES
  }
}

/** 生成形如 SO-20260903-A3F7 的单号。 */
function generateOrderId(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `SO-${d}-${rnd}`
}

function rowToOrder(r: Record<string, unknown>): Order {
  return {
    id: String(r.id),
    title: String(r.title),
    status: r.status as OrderStatus,
    amount: Number(r.amount),
    createdAt: String(r.created_at),
    tenant: String(r.tenant),
  }
}
