/**
 * Microsoft SQL Server 订单数据源实现。
 *
 * 通过 mssql 驱动连接 SQL Server；连接串从环境变量 ORDER_DB_MSSQL 注入
 * （由启动进程传入，禁止硬编码凭据）。首次查询时惰性建连并初始化表结构
 * （biz_orders、biz_stock），但不写入任何种子数据——数据一律由数据库侧管理。
 */

import mssql from 'mssql'
import { getSharedPool } from '@my-company/biz-shared'
import type { CreateOrderInput, Order, OrderDataSource, OrderFilter, OrderListItem, OrderStatus, StockInfo } from './types'

const ALL_STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'completed', 'cancelled']

export class SqlServerOrderDataSource implements OrderDataSource {
  private pool: mssql.ConnectionPool | null = null

  constructor(private readonly connString: string) {}

  private async getPool(): Promise<mssql.ConnectionPool> {
    if (!this.pool) {
      this.pool = await getSharedPool(this.connString)
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
        tenant     nvarchar(128) NOT NULL,
        customer_id nvarchar(128) NOT NULL,
        sku        nvarchar(128) NOT NULL,
        invoice_id nvarchar(128) NULL
      );
    `)
    await pool.request().query(`
      IF OBJECT_ID('dbo.biz_stock', 'U') IS NULL
      CREATE TABLE dbo.biz_stock (
        sku       nvarchar(128) NOT NULL PRIMARY KEY,
        available int NOT NULL,
        allocated int NOT NULL,
        tenant    nvarchar(128) NOT NULL
      );
    `)
  }

  async listOrders(tenant: string, filter?: OrderFilter, limit = 10): Promise<OrderListItem[]> {
    const pool = await this.getPool()
    const req = pool.request().input('tenant', mssql.NVarChar, tenant)
    const clauses: string[] = ['tenant = @tenant']
    if (filter?.status) {
      req.input('status', mssql.NVarChar, filter.status)
      clauses.push('status = @status')
    }
    if (filter?.customerId) {
      req.input('cid', mssql.NVarChar, filter.customerId)
      clauses.push('customer_id = @cid')
    }
    if (filter?.keyword) {
      req.input('kw', mssql.NVarChar, `%${filter.keyword}%`)
      clauses.push('(title LIKE @kw OR id LIKE @kw)')
    }
    req.input('limit', mssql.Int, Math.max(1, limit))
    const { recordset } = await req.query(
      `SELECT id, title, status, amount
       FROM dbo.biz_orders
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`,
    )
    return recordset.map(rowToList)
  }

  async getOrder(tenant: string, orderId: string): Promise<Order | null> {
    const pool = await this.getPool()
    const { recordset } = await pool
      .request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('id', mssql.NVarChar, orderId)
      .query(
        'SELECT id, title, status, amount, created_at, tenant, customer_id, sku, invoice_id '
        + 'FROM dbo.biz_orders WHERE tenant = @tenant AND id = @id',
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
    const customerId = input.customerId?.trim() || 'U-UNKNOWN'
    const sku = input.sku?.trim() || 'SKU-UNKNOWN'

    try {
      await pool
        .request()
        .input('id', mssql.NVarChar, id)
        .input('title', mssql.NVarChar, title)
        .input('status', mssql.NVarChar, status)
        .input('amount', mssql.Decimal(18, 2), amount)
        .input('created_at', mssql.NVarChar, createdAt)
        .input('tenant', mssql.NVarChar, tenant)
        .input('customer_id', mssql.NVarChar, customerId)
        .input('sku', mssql.NVarChar, sku)
        .input('invoice_id', mssql.NVarChar, '')
        .query(
          'INSERT INTO dbo.biz_orders (id, title, status, amount, created_at, tenant, customer_id, sku, invoice_id) '
          + 'VALUES (@id, @title, @status, @amount, @created_at, @tenant, @customer_id, @sku, @invoice_id)',
        )
    } catch (e) {
      // SQL Server 主键冲突错误号 2627 / 2601
      const code = (e as { number?: number }).number
      if (code === 2627 || code === 2601) throw new Error(`订单号 ${id} 已存在，请换一个`)
      throw e
    }
    return { id, title, status, amount, createdAt, tenant, customerId, sku, invoiceId: null }
  }

  async checkStock(sku: string, _tenant: string): Promise<StockInfo> {
    const pool = await this.getPool()
    const { recordset } = await pool
      .request()
      .input('sku', mssql.NVarChar, sku)
      .query('SELECT sku, available, allocated FROM dbo.biz_stock WHERE sku = @sku')
    const row = recordset[0]
    return row
      ? { sku: String(row.sku), available: Number(row.available), allocated: Number(row.allocated) }
      : { sku, available: 0, allocated: 0 }
  }

  listStatuses(): readonly OrderStatus[] {
    return ALL_STATUSES
  }

  async updateStatus(tenant: string, orderId: string, status: OrderStatus): Promise<Order | null> {
    if (!ALL_STATUSES.includes(status)) throw new Error(`不支持的订单状态：${status}`)
    const pool = await this.getPool()
    const res = await pool
      .request()
      .input('status', mssql.NVarChar, status)
      .input('id', mssql.NVarChar, orderId)
      .input('tenant', mssql.NVarChar, tenant)
      .query('UPDATE dbo.biz_orders SET status = @status WHERE id = @id AND tenant = @tenant')
    if ((res.rowsAffected?.[0] ?? 0) === 0) return null
    return this.getOrder(tenant, orderId)
  }
}

/** 生成形如 SO-20260903-A3F7 的单号。 */
function generateOrderId(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `SO-${d}-${rnd}`
}

function rowToList(r: Record<string, unknown>): OrderListItem {
  return {
    id: String(r.id),
    title: String(r.title),
    status: r.status as OrderStatus,
    amount: Number(r.amount),
  }
}

function rowToOrder(r: Record<string, unknown>): Order {
  const invoiceId = r.invoice_id == null ? null : String(r.invoice_id)
  return {
    id: String(r.id),
    title: String(r.title),
    status: r.status as OrderStatus,
    amount: Number(r.amount),
    createdAt: String(r.created_at),
    tenant: String(r.tenant),
    customerId: String(r.customer_id),
    sku: String(r.sku),
    invoiceId: invoiceId && invoiceId.length > 0 ? invoiceId : null,
  }
}
