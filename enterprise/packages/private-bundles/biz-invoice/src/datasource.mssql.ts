/**
 * biz-invoice 的 SQL Server 实现。
 *
 * 与 biz-order / biz-user / biz-knowledge 同一套样板：
 *   惰性建连 → ensureSchema() 自动建表（不存在才建）并 seed demo 种子 → 参数化多租户查询。
 * 通过 getInvoiceDataSource() 工厂按 INVOICE_DATASOURCE=mssql 选择本实现，
 * 业务工具代码零改动。连接串读 INVOICE_DB_MSSQL 环境变量。
 *
 * 发票的 orderId 与 biz_order（biz-order Bundle 的表）在业务上关联——
 * 两个 Bundle 各自独立建表/读写，本实现不做跨表 JOIN，仅存 orderId 供上层关联。
 */

import mssql from 'mssql'
import type { Invoice, InvoiceDataSource, InvoiceFilter, InvoiceStatus } from './types'

const ALL_STATUSES: InvoiceStatus[] = ['issued', 'sent', 'paid', 'overdue', 'cancelled']

const CONN = process.env.INVOICE_DB_MSSQL

/** demo 种子：与 mock 数据源保持一致；金额与 biz_order 中对应订单一致，便于演示跨 Bundle 关联。 */
const SEED_INVOICES: Invoice[] = [
  { id: 'INV-2026-0001', orderId: 'SO-1001', amount: 12000, taxRate: 0.06, status: 'paid', issuedAt: '2026-08-01', dueAt: '2026-08-31', tenant: 'demo' },
  { id: 'INV-2026-0002', orderId: 'SO-1002', amount: 8000, taxRate: 0.06, status: 'sent', issuedAt: '2026-08-12', dueAt: '2026-09-12', tenant: 'demo' },
  { id: 'INV-2026-0003', orderId: 'SO-1003', amount: 25000, taxRate: 0.13, status: 'issued', issuedAt: '2026-08-20', dueAt: '2026-09-20', tenant: 'demo' },
  { id: 'INV-2026-0004', orderId: 'SO-1004', amount: 6000, taxRate: 0.06, status: 'overdue', issuedAt: '2026-07-15', dueAt: '2026-08-15', tenant: 'demo' },
]

let poolPromise: Promise<mssql.ConnectionPool> | null = null

function getPool(): Promise<mssql.ConnectionPool> {
  if (!poolPromise) {
    if (!CONN) throw new Error('INVOICE_DB_MSSQL 未配置，无法连接 SQL Server')
    poolPromise = new mssql.ConnectionPool(CONN).connect()
  }
  return poolPromise
}

/** 建表（不存在才建）+ 幂等 seed。金额用 decimal(18,2) 与 biz_order 一致。 */
async function ensureSchema(pool: mssql.ConnectionPool): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID('dbo.biz_invoices', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.biz_invoices (
        id        NVARCHAR(32)   NOT NULL PRIMARY KEY,
        orderId   NVARCHAR(32)   NOT NULL,          -- 关联 biz_order.id（跨 Bundle，逻辑关联不建外键）
        amount    decimal(18,2)  NOT NULL,
        taxRate   decimal(5,4)   NOT NULL,
        status    NVARCHAR(16)   NOT NULL,
        issuedAt  NVARCHAR(32)   NOT NULL,
        dueAt     NVARCHAR(32)   NOT NULL,
        tenant    NVARCHAR(64)   NOT NULL
      );
    END
  `)
  const { recordset } = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.biz_invoices`)
  if (Number(recordset[0].n) === 0) {
    for (const inv of SEED_INVOICES) {
      await pool.request()
        .input('id', mssql.NVarChar, inv.id)
        .input('orderId', mssql.NVarChar, inv.orderId)
        .input('amount', mssql.Decimal(18, 2), inv.amount)
        .input('taxRate', mssql.Decimal(5, 4), inv.taxRate)
        .input('status', mssql.NVarChar, inv.status)
        .input('issuedAt', mssql.NVarChar, inv.issuedAt)
        .input('dueAt', mssql.NVarChar, inv.dueAt)
        .input('tenant', mssql.NVarChar, inv.tenant)
        .query(`
          INSERT INTO dbo.biz_invoices (id, orderId, amount, taxRate, status, issuedAt, dueAt, tenant)
          VALUES (@id, @orderId, @amount, @taxRate, @status, @issuedAt, @dueAt, @tenant)
        `)
    }
  }
}

function rowToInvoice(row: Record<string, unknown>): Invoice {
  return {
    id: String(row.id),
    orderId: String(row.orderId),
    amount: Number(row.amount),   // decimal 驱动可能返回 string，统一 Number()
    taxRate: Number(row.taxRate),
    status: String(row.status) as InvoiceStatus,
    issuedAt: String(row.issuedAt),
    dueAt: String(row.dueAt),
    tenant: String(row.tenant),
  }
}

export class SqlServerInvoiceDataSource implements InvoiceDataSource {
  async listInvoices(tenant: string, filter?: InvoiceFilter, limit = 10): Promise<Invoice[]> {
    const pool = await getPool()
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
    if (filter?.keyword) {
      conds.push('(id LIKE @kw OR orderId LIKE @kw)')
      req.input('kw', mssql.NVarChar, `%${filter.keyword}%`)
    }
    const n = Math.max(1, limit)
    const { recordset } = await req.query(`
      SELECT TOP (${n}) id, orderId, amount, taxRate, status, issuedAt, dueAt, tenant
      FROM dbo.biz_invoices
      WHERE ${conds.join(' AND ')}
      ORDER BY id
    `)
    return recordset.map(rowToInvoice)
  }

  async getInvoice(tenant: string, invoiceId: string): Promise<Invoice | null> {
    const pool = await getPool()
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('id', mssql.NVarChar, invoiceId)
      .query(`
        SELECT id, orderId, amount, taxRate, status, issuedAt, dueAt, tenant
        FROM dbo.biz_invoices
        WHERE tenant = @tenant AND id = @id
      `)
    return recordset[0] ? rowToInvoice(recordset[0]) : null
  }

  listStatuses(): readonly InvoiceStatus[] {
    return ALL_STATUSES
  }
}
