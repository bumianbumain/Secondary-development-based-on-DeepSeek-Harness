/**
 * 账单/发票业务领域模型。
 * 仅描述数据形状，不依赖数据源实现——便于真实财务系统接入时复用。
 */

export type InvoiceStatus = 'issued' | 'sent' | 'paid' | 'overdue' | 'cancelled'

/** 发票明细行。列表查询不含此结构，只有详情查询才返回——这是详情工具的信息增量所在。 */
export interface InvoiceLineItem {
  sku: string
  name: string
  quantity: number
  unitPrice: number
}

export interface Invoice {
  id: string
  orderId: string
  /** 关联客户 ID，可下钻到 biz-user 的 query_user_profile(customerId)。 */
  customerId: string
  amount: number
  taxRate: number
  status: InvoiceStatus
  issuedAt: string
  dueAt: string
  /** 已收金额；amount 与它的差额即未收尾款。 */
  paidAmount: number
  /** 最近一次收款时间；未收款为 null。 */
  paidAt: string | null
  currency: string
  /** 明细行：列表工具不返回，仅详情工具返回。 */
  lineItems: InvoiceLineItem[]
  /** 归属租户（多租户隔离单元）。 */
  tenant: string
}

export interface InvoiceFilter {
  status?: InvoiceStatus
  orderId?: string
  customerId?: string
  keyword?: string
}

/** 开票的入参。 */
export interface CreateInvoiceInput {
  orderId: string
  customerId: string
  amount: number
  /** 税率，默认 0.06。 */
  taxRate?: number
  /** 明细行，可选。 */
  lineItems?: InvoiceLineItem[]
  /** 币种，默认 CNY。 */
  currency?: string
}

/** 按状态的动态聚合结果——数据来源是实时统计，不是静态枚举，因此对模型有信息增量。 */
export interface InvoiceStatusSummary {
  status: InvoiceStatus
  /** 该状态的发票数量。 */
  count: number
  /** 该状态发票金额合计。 */
  totalAmount: number
  /** 该状态下未结清且已过到期日的金额合计。 */
  overdueAmount: number
}

/** 数据源契约：所有账单/发票访问都经由该接口，便于 mock ↔ 真实实现切换。 */
export interface InvoiceDataSource {
  listInvoices(tenant: string, filter?: InvoiceFilter, limit?: number): Promise<Invoice[]>
  getInvoice(tenant: string, invoiceId: string): Promise<Invoice | null>
  listStatuses(): readonly InvoiceStatus[]
  /** 按状态聚合当前租户的发票分布（数量 / 金额 / 逾期金额）。 */
  summarizeByStatus(tenant: string): Promise<InvoiceStatusSummary[]>
  /** 开票：给一笔订单创建发票。订单已开票则报错。 */
  createInvoice(tenant: string, input: CreateInvoiceInput): Promise<Invoice>
  /** 更新发票状态。返回更新后的发票；发票不存在则返回 null。 */
  updateStatus(tenant: string, invoiceId: string, status: InvoiceStatus): Promise<Invoice | null>
}
