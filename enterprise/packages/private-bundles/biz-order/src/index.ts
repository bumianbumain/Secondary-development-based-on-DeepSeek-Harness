/**
 * @my-company/biz-order — 企业订单业务 Bundle（P1 示例 + 测试工具集）
 *
 * 在不修改 DSH 核心源码的前提下，向工具注册表注入一组订单业务工具。
 * 多租户隔离基于**会话级 tenant**（`exec.agent.session.id`，即 dsh-session 的 SessionId），
 * 绝不依赖任何全局变量。所有数据访问都经由 datasource.ts 的 OrderDataSource 抽象，
 * 当前为内存 mock，后续可无缝切换为真实中台实现。
 *
 * 装配顺序：dsh-base → dsh-web-app → 本 Bundle（按 profile 的 bundles 列表）。
 *
 * @module @my-company/biz-order
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { getOrderDataSource } from './datasource.js'
import type { OrderStatus } from './types'

/** 稳定 Cordis 插件名，须与 cordis.patch.yml 中插入行的 `name` 一致。 */
export const name = 'biz-order'

/** 仅依赖 tools 服务（dsh-base 已提供）；声明后 `apply` 才能拿到 `ctx.tools`。 */
export const inject = ['tools']

/**
 * 从执行上下文解析租户标识。
 * 有会话时严格按会话隔离；无会话（如 CLI 冒烟测试）回退 'demo' 以打通测试链路。
 */
function resolveTenant(exec: ToolRunContext): string {
  return exec.agent?.session?.id ?? 'demo'
}

/** Bundle 插件入口：注册业务工具并登记资源生命周期。 */
export function apply(ctx: Context): void {
  // 资源生命周期：用 ctx.effect 登记连接，卸载时按反序自动清理（DSH 强制要求，防泄漏）。
  ctx.effect(() => {
    // 真实场景：const conn = internalApi.connect()
    return () => {
      // 真实场景：conn.close()
    }
  })

  const ds = getOrderDataSource()

  // —— 工具 1：订单列表（按状态/关键字筛选） ——
  ctx.tools.register(defineTool({
    name: 'query_user_orders',
    description:
      '查询当前租户/会话下的订单列表，可按状态或关键字筛选。当用户询问订单状态、历史购买记录、'
      + '待付款或已发货订单时使用。返回结果按当前会话隔离，不会跨租户泄露。',
    parameters: {
      status: {
        type: 'string',
        enum: ['pending', 'paid', 'shipped', 'completed', 'cancelled'],
        description: '订单状态筛选；省略则返回全部状态。',
      },
      keyword: {
        type: 'string',
        description: '标题/单号关键字模糊匹配；省略则不筛选。',
      },
      limit: {
        type: 'number',
        description: '返回条数上限，默认 10。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec)
      const orders = await ds.listOrders(tenant, {
        status: args.status as OrderStatus | undefined,
        keyword: args.keyword,
      }, args.limit)
      return { tenant, count: orders.length, orders } as any
    },
  }))

  // —— 工具 2：订单详情 ——
  ctx.tools.register(defineTool({
    name: 'query_order_detail',
    description: '根据订单单号查询单笔订单的详情。当用户追问某个具体订单（如 SO-1001）的状态、金额时调用。',
    parameters: {
      order_id: {
        type: 'string',
        description: '订单单号，如 SO-1001。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec)
      const orderId = args.order_id ?? ''
      const order = await ds.getOrder(tenant, orderId)
      if (!order) {
        return { tenant, found: false, order_id: orderId } as any
      }
      return { tenant, found: true, order } as any
    },
  }))

  // —— 工具 3：可下单状态枚举（轻量元数据工具，演示扩展模式） ——
  ctx.tools.register(defineTool({
    name: 'list_order_statuses',
    description: '列出系统支持的订单状态枚举值，供上層对话或表单使用。',
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
