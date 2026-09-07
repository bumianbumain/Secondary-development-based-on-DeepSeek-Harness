/**
 * @my-company/biz-invoice — 企业账单/发票业务 Bundle（测试流程演示）
 *
 * 在不修改 DSH 核心源码的前提下，向工具注册表注入一组账单/发票查询工具。
 * 多租户隔离基于 exec.agent?.session?.id，数据访问经由 InvoiceDataSource 抽象。
 *
 * 工具分层（刻意制造信息增量，避免出现「列表已含全部字段 → 详情零调用」的死工具）：
 *   query_invoices        → 只给定位字段，不含明细行
 *   query_invoice_detail  → 完整信息 + 明细行 + 收款进度 + 逾期天数
 *   summarize_invoice_statuses → 实时聚合分布（不是静态枚举，所以有查询价值）
 *
 * @module @my-company/biz-invoice
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { getInvoiceDataSource } from './datasource.js'
import { resolveTenant } from '@my-company/biz-shared'
import type { Invoice, InvoiceStatus } from './types'

export const name = 'biz-invoice'
export const inject = ['tools']

/** 列表视图：只暴露定位所需字段，明细行与收款细节留给详情工具。 */
function toSummary(inv: Invoice) {
  return {
    id: inv.id,
    orderId: inv.orderId,
    customerId: inv.customerId,
    status: inv.status,
    amount: inv.amount,
    currency: inv.currency,
    issuedAt: inv.issuedAt,
    dueAt: inv.dueAt,
  }
}

/** 逾期天数：已结清或未到期均为 0。 */
function overdueDays(inv: Invoice, today: string): number {
  if (inv.paidAmount >= inv.amount) return 0
  const diff = Date.parse(today) - Date.parse(inv.dueAt)
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    return () => {}
  })

  const ds = getInvoiceDataSource()

  ctx.tools.register(defineTool({
    name: 'query_invoices',
    description:
      '查询当前租户下的账单/发票列表，可按状态、关联订单、客户或关键字筛选。'
      + '只返回定位字段（发票号、订单号、客户、状态、金额、开票/到期日），不含明细行与收款细节；'
      + '若需要知道某张发票具体包含哪些商品、已收多少款、逾期多久，请用返回的 id 调用 query_invoice_detail。',
    parameters: {
      status: {
        type: 'string',
        enum: ['issued', 'sent', 'paid', 'overdue', 'cancelled'],
        description: '发票状态筛选；省略则返回全部。',
      },
      order_id: { type: 'string', description: '关联订单号筛选，如 SO-1001。' },
      customer_id: { type: 'string', description: '客户 ID 筛选，如 U-1001。' },
      keyword: { type: 'string', description: '发票号/订单号关键字模糊匹配。' },
      limit: { type: 'number', description: '返回条数上限，默认 10。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'INVOICE_TENANT')
      const invoices = await ds.listInvoices(tenant, {
        status: args.status as InvoiceStatus | undefined,
        orderId: args.order_id,
        customerId: args.customer_id,
        keyword: args.keyword,
      }, args.limit)
      return {
        tenant,
        count: invoices.length,
        invoices: invoices.map(toSummary),
        hint: '需要某张发票的明细行与收款进度，请用其 id 调用 query_invoice_detail。',
      } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'query_invoice_detail',
    description:
      '查询单笔发票的完整详情：包含商品明细行、税额拆分、已收/未收金额、收款时间与逾期天数。'
      + '当你需要回答「这张发票具体开了什么」「还欠多少钱」「逾期了多少天」时使用——'
      + '这些信息 query_invoices 列表不包含。',
    parameters: {
      invoice_id: { type: 'string', description: '发票号，如 INV-2026-0001。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'INVOICE_TENANT')
      const invoiceId = args.invoice_id ?? ''
      const inv = await ds.getInvoice(tenant, invoiceId)
      if (!inv) {
        return { tenant, found: false, invoice_id: invoiceId } as any
      }
      const today = new Date().toISOString().slice(0, 10)
      const netAmount = Number((inv.amount / (1 + inv.taxRate)).toFixed(2))
      return {
        tenant,
        found: true,
        invoice: { ...inv },
        breakdown: {
          grossAmount: inv.amount,
          netAmount,
          taxAmount: Number((inv.amount - netAmount).toFixed(2)),
          taxRate: inv.taxRate,
          paidAmount: inv.paidAmount,
          outstanding: Number((inv.amount - inv.paidAmount).toFixed(2)),
          paidAt: inv.paidAt,
          overdueDays: overdueDays(inv, today),
        },
        links: {
          order: `可用 query_order_detail 查 order_id=${inv.orderId}`,
          customer: `可用 query_user_profile 查 customerId=${inv.customerId}`,
        },
      } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'summarize_invoice_statuses',
    description:
      '统计当前租户下各状态发票的数量、金额合计与逾期未收金额。'
      + '这是实时聚合结果（不是固定枚举），用于应收账款分析、账期巡检和逾期风险排查。'
      + '当被问到「有多少发票未收款」「逾期金额一共多少」「各状态分别多少张/多少钱」时调用本工具。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'INVOICE_TENANT')
      const rows = await ds.summarizeByStatus(tenant)
      const total = rows.reduce((s, r) => s + r.count, 0)
      return {
        tenant,
        currency: 'CNY',
        totalInvoices: total,
        totalAmount: rows.reduce((s, r) => s + r.totalAmount, 0),
        totalOverdueAmount: rows.reduce((s, r) => s + r.overdueAmount, 0),
        byStatus: rows,
      } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_invoice',
    description:
      '给一笔订单开票（生成发票）。当用户表示「开票」「开发票」「订单要开票」时调用。'
      + '同一订单已开票会报错，不会重复开票。金额、订单号、客户必填。',
    parameters: {
      order_id: { type: 'string', description: '关联的订单单号，如 SO-20260904-A001。' },
      customer_id: { type: 'string', description: '客户 ID，如 U-001。' },
      amount: { type: 'number', description: '发票金额（不含税），非负数。' },
      tax_rate: { type: 'number', description: '税率，默认 0.06。' },
      currency: { type: 'string', description: '币种，默认 CNY。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'INVOICE_TENANT')
      try {
        const invoice = await ds.createInvoice(tenant, {
          orderId: String(args.order_id ?? ''),
          customerId: String(args.customer_id ?? ''),
          amount: Number(args.amount),
          taxRate: args.tax_rate,
          currency: args.currency,
        })
        return { ok: true, tenant, invoice } as any
      } catch (e) {
        return { ok: false, tenant, error: (e as Error).message } as any
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'update_invoice_status',
    description:
      '更新发票状态（如 issued→sent→paid / overdue / cancelled）。'
      + '当发票状态发生变化（已寄出、已收款、逾期、作废）时调用。'
      + '发票不存在返回 found:false。',
    parameters: {
      invoice_id: { type: 'string', description: '发票号，如 INV-20260904-XXXX。' },
      status: {
        type: 'string',
        enum: ['issued', 'sent', 'paid', 'overdue', 'cancelled'],
        description: '目标状态。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'INVOICE_TENANT')
      const invoiceId = String(args.invoice_id ?? '')
      try {
        const invoice = await ds.updateStatus(tenant, invoiceId, args.status as InvoiceStatus)
        if (!invoice) return { tenant, found: false, invoice_id: invoiceId } as any
        return { tenant, found: true, invoice } as any
      } catch (e) {
        return { tenant, found: false, invoice_id: invoiceId, error: (e as Error).message } as any
      }
    },
  }))
}
