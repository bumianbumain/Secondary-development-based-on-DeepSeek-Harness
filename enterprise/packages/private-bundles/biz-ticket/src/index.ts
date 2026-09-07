/**
 * @my-company/biz-ticket — 企业 IT 工单业务 Bundle
 *
 * 不修改 DSH 核心源码，向工具注册表注入一组工单业务工具。
 * 多租户隔离基于会话级 tenant，绝不依赖全局变量。
 * 所有数据访问经由 datasource.ts 的 TicketDataSource 抽象，
 * 直接连接 SQL Server（TICKET_DB_MSSQL），数据增删改一律在数据库侧完成。
 *
 * @module @my-company/biz-ticket
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { getTicketDataSource } from './datasource.js'
import { resolveTenant } from '@my-company/biz-shared'
import type { TicketPriority, TicketStatus } from './types'

/** 稳定 Cordis 插件名，须与 cordis.patch.yml 中插入行的 `name` 一致。 */
export const name = 'biz-ticket'

/** 仅依赖 tools 服务（dsh-base 已提供）；声明后 `apply` 才能拿到 `ctx.tools`。 */
export const inject = ['tools']

const STATUSES: TicketStatus[] = ['open', 'processing', 'resolved', 'closed', 'cancelled']
const PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'urgent']

/** Bundle 插件入口：注册业务工具并登记资源生命周期。 */
export function apply(ctx: Context): void {
  // 资源生命周期：用 ctx.effect 登记连接，卸载时按反序自动清理（DSH 强制要求，防泄漏）。
  ctx.effect(() => {
    // 真实场景：const conn = internalApi.connect()
    return () => {
      // 真实场景：conn.close()
    }
  })

  const ds = getTicketDataSource()

  // —— 工具 1：工单列表—
  ctx.tools.register(defineTool({
    name: 'query_tickets',
    description:'查询当前租户/会话下的工单列表，可按状态/优先级/关键字筛选。'
      + '当用户询问"我的工单""待处理的工单""历史工单"时使用。返回结果按当前会话隔离。',
    parameters: {
      status: { type: 'string', enum: STATUSES, description: '状态筛选；省略则返回全部。' },
      priority: { type: 'string', enum: PRIORITIES, description: '优先级筛选；省略则返回全部。' },
      assignee: { type: 'string', description: '按处理人筛选。' },
      keyword: { type: 'string', description: '标题/描述/工单号模糊匹配。' },
      limit: { type: 'number', description: '返回条数上限，默认 10。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'TICKET_TENANT')
      const tickets = await ds.listTickets(tenant, {
        status: args.status as TicketStatus | undefined,
        priority: args.priority as TicketPriority | undefined,
        assignee: args.assignee,
        keyword: args.keyword,
      }, args.limit)
      return { tenant, count: tickets.length, tickets } as any
    },
  }))

  // —— 工具 2：工单详情
  ctx.tools.register(defineTool({
    name: 'get_ticket_details',
    description: '获取指定工单的详细信息。',
    parameters: {
      ticket_id: {
        type: 'string',
        description: '工单 ID，必填。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'TICKET_TENANT')
      const ticket = await ds.getTicket(tenant, String(args.ticket_id ?? ''))
      return { tenant, found: !!ticket, ticket } as any
    },
  }))

  // —— 工具 3：创建工单—
    ctx.tools.register(defineTool({
    name: 'create_ticket',
    description: '在当前租户下新建工单。标题与报单人必填，状态默认 open。',
    parameters: {
      title: { type: 'string', description: '工单标题，必填。' },
      reporter: { type: 'string', description: '报单人，必填。' },
      description: { type: 'string', description: '问题描述。' },
      priority: { type: 'string', enum: PRIORITIES, description: '优先级；省略则 medium。' },
      assignee: { type: 'string', description: '指派的处理人。' },
      id: { type: 'string', description: '指定工单号；省略则自动生成 T-xxx。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'TICKET_TENANT')
      try {
        const ticket = await ds.createTicket(tenant, {
          id: args.id,
          title: String(args.title ?? ''),
          description: args.description ?? null,
          priority: args.priority as TicketPriority | undefined,
          assignee: args.assignee ?? null,
          reporter: String(args.reporter ?? ''),
        })
        return { ok: true, tenant, ticket } as any
      } catch (e) {
        return { ok: false, tenant, error: (e as Error).message } as any
      }
    },
  }))

  // 工具 4：状态变更（状态机由 datasource 内部校验）
  ctx.tools.register(defineTool({
    name: 'update_ticket_status',
    description: '变更工单状态。仅允许合法流转（如 open→processing→resolved→closed），非法流转会报错。',
    parameters: {
      ticket_id: { type: 'string', description: '工单号，必填。' },
      status: { type: 'string', enum: STATUSES, description: '目标状态，必填。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'TICKET_TENANT')
      try {
        const ticket = await ds.updateTicketStatus(tenant, String(args.ticket_id ?? ''), args.status as TicketStatus)
        return { ok: true, tenant, ticket } as any
      } catch (e) {
        return { ok: false, tenant, error: (e as Error).message } as any
      }
    },
  }))

  // 工具 5：统计
  ctx.tools.register(defineTool({
    name: 'ticket_stats',
    description: '统计当前租户工单总数及各状态分布。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'TICKET_TENANT')
      const stats = await ds.getStats(tenant)
      return { tenant, ...stats } as any
    },
  }))
}