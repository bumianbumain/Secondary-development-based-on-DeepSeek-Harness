/**
 * 账单/发票业务领域模型。
 * 仅描述数据形状，不依赖数据源实现——便于真实财务系统接入时复用。
 */

export type InvoiceStatus = 'issued' | 'sent' | 'paid' | 'overdue' | 'cancelled'

export interface Invoice {
  id: string
  orderId: string
  amount: number
  taxRate: number
  status: InvoiceStatus
  issuedAt: string
  dueAt: string
  /** 归属租户（多租户隔离单元）。 */
  tenant: string
}

export interface InvoiceFilter {
  status?: InvoiceStatus
  orderId?: string
  keyword?: string
}

/** 数据源契约：所有账单/发票访问都经由该接口，便于 mock ↔ 真实实现切换。 */
export interface InvoiceDataSource {
  listInvoices(tenant: string, filter?: InvoiceFilter, limit?: number): Promise<Invoice[]>
  getInvoice(tenant: string, invoiceId: string): Promise<Invoice | null>
  listStatuses(): readonly InvoiceStatus[]
}
