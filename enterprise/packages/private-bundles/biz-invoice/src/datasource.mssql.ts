/**
 * biz-invoice 的 SQL Server 实现。
 *
 * 惰性建连 → ensureSchema() 自动建表（不存在才建）→ 参数化多租户查询。
 * 不写入任何种子数据——数据一律由数据库侧管理。
 * 连接串读 INVOICE_DB_MSSQL 环境变量。
 *
 * 发票的 orderId 与 biz_order（biz-order Bundle 的表）在业务上关联——
 * 两个 Bundle 各自独立建表/读写，本实现不做跨表 JOIN，仅存 orderId 供上层关联。
 * 明细行以 JSON 字符串存于 lineItemsJson 列，避免为子表再建一张物理表。
 */

import mssql from 'mssql'
import { generateBusinessId, getSharedPool } from '@my-company/biz-shared'
import type {
  CreateInvoiceInput,
  Invoice,
  InvoiceDataSource,
  InvoiceFilter,
  InvoiceLineItem,
  InvoiceStatus,
  InvoiceStatusSummary,
} from './types'

const ALL_STATUSES: InvoiceStatus[] = ['issued', 'sent', 'paid', 'overdue', 'cancelled']

const CONN = process.env.INVOICE_DB_MSSQL!

/** 建表（不存在才建）。金额用 decimal(18,2) 与 biz_order 一致。 */
async function ensureSchema(pool: mssql.ConnectionPool): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID('dbo.biz_invoices', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.biz_invoices (
        id            NVARCHAR(32)   NOT NULL PRIMARY KEY,
        orderId       NVARCHAR(32)   NOT NULL,          -- 关联 biz_order.id（跨 Bundle，逻辑关联不建外键）
        customerId    NVARCHAR(32)   NULL,              -- 关联 biz_user.id，可下钻查客户档案
        amount        decimal(18,2)  NOT NULL,
        taxRate       decimal(5,4)   NOT NULL,
        status        NVARCHAR(16)   NOT NULL,
        issuedAt      NVARCHAR(32)   NOT NULL,
        dueAt         NVARCHAR(32)   NOT NULL,
        paidAmount    decimal(18,2)  NOT NULL DEFAULT 0,
        paidAt        NVARCHAR(32)   NULL,
        currency      NVARCHAR(8)    NOT NULL DEFAULT 'CNY',
        lineItemsJson NVARCHAR(MAX)  NULL,              -- 明细行 JSON 数组
        tenant        NVARCHAR(64)   NOT NULL
      );
    END
  `)
}

const COLUMNS = 'id, orderId, customerId, amount, taxRate, status, issuedAt, dueAt, paidAmount, paidAt, currency, lineItemsJson, tenant'

function parseLineItems(raw: unknown): InvoiceLineItem[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as InvoiceLineItem[] : []
  } catch {
    return []
  }
}

function rowToInvoice(row: Record<string, unknown>): Invoice {
  return {
    id: String(row.id),
    orderId: String(row.orderId),
    customerId: row.customerId == null ? '' : String(row.customerId),
    amount: Number(row.amount),   // decimal 驱动可能返回 string，统一 Number()
    taxRate: Number(row.taxRate),
    status: String(row.status) as InvoiceStatus,
    issuedAt: String(row.issuedAt),
    dueAt: String(row.dueAt),
    paidAmount: Number(row.paidAmount ?? 0),
    paidAt: row.paidAt == null ? null : String(row.paidAt),
    currency: row.currency == null ? 'CNY' : String(row.currency),
    lineItems: parseLineItems(row.lineItemsJson),
    tenant: String(row.tenant),
  }
}

export class SqlServerInvoiceDataSource implements InvoiceDataSource {
  async listInvoices(tenant: string, filter?: InvoiceFilter, limit = 10): Promise<Invoice[]> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const req = pool.request()
    const conds: string[] = ['tenant = @tenant']
    req.input('tenant', mssql.NVarChar, tenant)
    if (filter?.status) {
      conds.push('status = @status')
      req.input('status', mssql.NVarChar, filter.status)
    }
    if (filter?.orderId) {
      conds.push('orderId = @orderId')
      req.input('orderId', mssql.NVarChar, filter.orderId)
    }
    if (filter?.customerId) {
      conds.push('customerId = @customerId')
      req.input('customerId', mssql.NVarChar, filter.customerId)
    }
    if (filter?.keyword) {
      conds.push('(id LIKE @kw OR orderId LIKE @kw)')
      req.input('kw', mssql.NVarChar, `%${filter.keyword}%`)
    }
    const n = Math.max(1, limit)
    const { recordset } = await req.query(`
      SELECT TOP (${n}) ${COLUMNS}
      FROM dbo.biz_invoices
      WHERE ${conds.join(' AND ')}
      ORDER BY id
    `)
    return recordset.map(rowToInvoice)
  }

  async getInvoice(tenant: string, invoiceId: string): Promise<Invoice | null> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('id', mssql.NVarChar, invoiceId)
      .query(`
        SELECT ${COLUMNS}
        FROM dbo.biz_invoices
        WHERE tenant = @tenant AND id = @id
      `)
    return recordset[0] ? rowToInvoice(recordset[0]) : null
  }

  listStatuses(): readonly InvoiceStatus[] {
    return ALL_STATUSES
  }

  /**
   * 用一条 GROUP BY 直接让数据库算分布，避免把整表拉回内存。
   * dueAt 以 ISO 日期串存放，字典序即时间序，可直接与 @today 比较。
   */
  async summarizeByStatus(tenant: string): Promise<InvoiceStatusSummary[]> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const today = new Date().toISOString().slice(0, 10)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('today', mssql.NVarChar, today)
      .query(`
        SELECT
          status,
          COUNT(*)                    AS count,
          SUM(amount)                 AS totalAmount,
          SUM(CASE WHEN paidAmount < amount AND dueAt < @today
                   THEN amount - paidAmount ELSE 0 END) AS overdueAmount
        FROM dbo.biz_invoices
        WHERE tenant = @tenant
        GROUP BY status
      `)
    const byStatus = new Map<string, { count: number; totalAmount: number; overdueAmount: number }>()
    for (const row of recordset as Array<Record<string, unknown>>) {
      byStatus.set(String(row.status), {
        count: Number(row.count ?? 0),
        totalAmount: Number(row.totalAmount ?? 0),
        overdueAmount: Number(row.overdueAmount ?? 0),
      })
    }
    // 补齐空状态，保证返回结构稳定（模型可据此判断"该状态当前无发票"）
    return ALL_STATUSES.map(status => {
      const hit = byStatus.get(status)
      return {
        status,
        count: hit?.count ?? 0,
        totalAmount: hit?.totalAmount ?? 0,
        overdueAmount: hit?.overdueAmount ?? 0,
      }
    })
  }

  /** 开票：给一笔订单创建发票。订单已开票则报错。 */
  async createInvoice(tenant: string, input: CreateInvoiceInput): Promise<Invoice> {
    const orderId = String(input.orderId ?? '').trim()
    if (!orderId) throw new Error('订单号不能为空')
    const amount = Number(input.amount)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('发票金额必须是非负数')

    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    // 幂等：同一订单已开票则拒绝重复开票
    const dup = await pool.request()
      .input('orderId', mssql.NVarChar, orderId)
      .input('tenant', mssql.NVarChar, tenant)
      .query('SELECT id FROM dbo.biz_invoices WHERE orderId = @orderId AND tenant = @tenant')
    if (dup.recordset.length > 0) {
      throw new Error(`订单 ${orderId} 已开票（发票号 ${String(dup.recordset[0].id)}），无需重复开票`)
    }

    const id = generateBusinessId('INV')
    const customerId = String(input.customerId ?? '').trim()
    const taxRate = Number(input.taxRate ?? 0.06)
    const currency = String(input.currency ?? 'CNY').trim() || 'CNY'
    const lineItems = input.lineItems ?? []
    const issuedAt = new Date().toISOString().slice(0, 10)
    const dueAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)

    await pool.request()
      .input('id', mssql.NVarChar, id)
      .input('orderId', mssql.NVarChar, orderId)
      .input('customerId', mssql.NVarChar, customerId)
      .input('amount', mssql.Decimal(18, 2), amount)
      .input('taxRate', mssql.Decimal(5, 4), taxRate)
      .input('status', mssql.NVarChar, 'issued')
      .input('issuedAt', mssql.NVarChar, issuedAt)
      .input('dueAt', mssql.NVarChar, dueAt)
      .input('paidAmount', mssql.Decimal(18, 2), 0)
      .input('paidAt', mssql.NVarChar, null)
      .input('currency', mssql.NVarChar, currency)
      .input('lineItemsJson', mssql.NVarChar, JSON.stringify(lineItems))
      .input('tenant', mssql.NVarChar, tenant)
      .query(`
        INSERT INTO dbo.biz_invoices
          (id, orderId, customerId, amount, taxRate, status, issuedAt, dueAt,
           paidAmount, paidAt, currency, lineItemsJson, tenant)
        VALUES
          (@id, @orderId, @customerId, @amount, @taxRate, @status, @issuedAt, @dueAt,
           @paidAmount, @paidAt, @currency, @lineItemsJson, @tenant)
      `)

    return (await this.getInvoice(tenant, id))!
  }

  /** 更新发票状态。返回更新后的发票；发票不存在则返回 null。 */
  async updateStatus(tenant: string, invoiceId: string, status: InvoiceStatus): Promise<Invoice | null> {
    if (!ALL_STATUSES.includes(status)) throw new Error(`不支持的发票状态：${status}`)
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const res = await pool.request()
      .input('status', mssql.NVarChar, status)
      .input('id', mssql.NVarChar, invoiceId)
      .input('tenant', mssql.NVarChar, tenant)
      .query('UPDATE dbo.biz_invoices SET status = @status WHERE id = @id AND tenant = @tenant')
    if ((res.rowsAffected?.[0] ?? 0) === 0) return null
    return this.getInvoice(tenant, invoiceId)
  }
}
