/**
 * 账单/发票数据源实现（扩展点）。
 *
 * 当前仅提供 MockInvoiceDataSource（内存假数据），用于演示多 Bundle 扩展流程。
 * 真实接入时**不要改这里之外的代码**：
 * 1. 新增一个实现 InvoiceDataSource 的类（如 RestInvoiceDataSource）；
 * 2. 在下方 getInvoiceDataSource() 中按环境变量 INVOICE_DATASOURCE 选择实现；
 * 3. 凭据从 DSH 凭证服务读取，禁止硬编码。
 */

import type { Invoice, InvoiceDataSource, InvoiceFilter, InvoiceStatus } from './types'

const ALL_STATUSES: InvoiceStatus[] = ['issued', 'sent', 'paid', 'overdue', 'cancelled']

/** 演示用内存库，按 tenant 分桶。真实部署替换为对财务系统的受保护调用。 */
const MOCK_DB: Record<string, Invoice[]> = {
  demo: [
    { id: 'INV-2026-0001', orderId: 'SO-1001', amount: 12000, taxRate: 0.06, status: 'paid', issuedAt: '2026-08-01', dueAt: '2026-08-31', tenant: 'demo' },
    { id: 'INV-2026-0002', orderId: 'SO-1002', amount: 8000, taxRate: 0.06, status: 'sent', issuedAt: '2026-08-12', dueAt: '2026-09-12', tenant: 'demo' },
    { id: 'INV-2026-0003', orderId: 'SO-1003', amount: 25000, taxRate: 0.13, status: 'issued', issuedAt: '2026-08-20', dueAt: '2026-09-20', tenant: 'demo' },
    { id: 'INV-2026-0004', orderId: 'SO-1004', amount: 6000, taxRate: 0.06, status: 'overdue', issuedAt: '2026-07-15', dueAt: '2026-08-15', tenant: 'demo' },
  ],
}

class MockInvoiceDataSource implements InvoiceDataSource {
  async listInvoices(tenant: string, filter?: InvoiceFilter, limit = 10): Promise<Invoice[]> {
    let rows = MOCK_DB[tenant] ?? []
    if (filter?.status) rows = rows.filter(i => i.status === filter.status)
    if (filter?.orderId) rows = rows.filter(i => i.orderId === filter.orderId)
    if (filter?.keyword) {
      const kw = filter.keyword.toLowerCase()
      rows = rows.filter(i =>
        i.id.toLowerCase().includes(kw) ||
        i.orderId.toLowerCase().includes(kw),
      )
    }
    return rows.slice(0, Math.max(1, limit))
  }

  async getInvoice(tenant: string, invoiceId: string): Promise<Invoice | null> {
    return (MOCK_DB[tenant] ?? []).find(i => i.id === invoiceId) ?? null
  }

  listStatuses(): readonly InvoiceStatus[] {
    return ALL_STATUSES
  }
}

let instance: InvoiceDataSource | null = null

/**
 * 数据源工厂（扩展点）。
 * 通过环境变量 INVOICE_DATASOURCE 选择实现；未配置时回退到 mock。
 * 未来接入真实财务系统时只改这里，业务工具代码不动。
 */
export function getInvoiceDataSource(): InvoiceDataSource {
  if (instance) return instance
  // 预留：const kind = process.env.INVOICE_DATASOURCE
  // if (kind === 'rest') instance = new RestInvoiceDataSource(...)
  instance = new MockInvoiceDataSource()
  return instance
}
