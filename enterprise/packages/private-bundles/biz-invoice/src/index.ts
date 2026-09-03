/**
 * @my-company/biz-invoice — 企业账单/发票业务 Bundle（测试流程演示）
 *
 * 在不修改 DSH 核心源码的前提下，向工具注册表注入一组账单/发票查询工具。
 * 多租户隔离基于 exec.agent?.session?.id，数据访问经由 InvoiceDataSource 抽象。
 *
 * @module @my-company/biz-invoice
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { getInvoiceDataSource } from './datasource'
import type { InvoiceStatus } from './types'

export const name = 'biz-invoice'
export const inject = ['tools']

/**
 * 从执行上下文解析租户标识。
 * 有会话时严格按会话隔离；无会话（如 CLI 冒烟测试）回退 'demo' 以打通测试链路。
 * INVOICE_TENANT 为演示开关：设置后把所有会话固定到指定租户，便于在 UI 里看到种子数据。
 */
function resolveTenant(exec: ToolRunContext): string {
  return process.env.INVOICE_TENANT || exec.agent?.session?.id || 'demo'
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    return () => {}
  })

  const ds = getInvoiceDataSource()

  ctx.tools.register(defineTool({
    name: 'query_invoices',
    description: '查询当前租户下的账单/发票列表，可按状态、关联订单或关键字筛选。',
    parameters: {
      status: {
        type: 'string',
        enum: ['issued', 'sent', 'paid', 'overdue', 'cancelled'],
        description: '发票状态筛选；省略则返回全部。',
      },
      order_id: { type: 'string', description: '关联订单号筛选，如 SO-1001。' },
      keyword: { type: 'string', description: '发票号/订单号关键字模糊匹配。' },
      limit: { type: 'number', description: '返回条数上限，默认 10。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec)
      const invoices = await ds.listInvoices(tenant, {
        status: args.status as InvoiceStatus | undefined,
        orderId: args.order_id,
        keyword: args.keyword,
      }, args.limit)
      return { tenant, count: invoices.length, invoices } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'query_invoice_detail',
    description: '根据发票号查询单笔发票详情。',
    parameters: {
      invoice_id: { type: 'string', description: '发票号，如 INV-2026-0001。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec)
      const invoiceId = args.invoice_id ?? ''
      const invoice = await ds.getInvoice(tenant, invoiceId)
      return invoice
        ? { tenant, found: true, invoice } as any
        : { tenant, found: false, invoice_id: invoiceId } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'list_invoice_statuses',
    description: '列出系统支持的发票状态枚举。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec: ToolRunContext) {
      return { tenant: resolveTenant(exec), statuses: ds.listStatuses() } as any
    },
  }))
}
