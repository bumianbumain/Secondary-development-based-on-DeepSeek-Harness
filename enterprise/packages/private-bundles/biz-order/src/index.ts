/**
 * @my-company/biz-order — 企业订单业务 Bundle（P1 示例 + 测试工具集）
 *
 * 在不修改 DSH 核心源码的前提下，向工具注册表注入一组订单业务工具。
 * 多租户隔离基于**会话级 tenant**（`exec.agent.session.id`，即 dsh-session 的 SessionId），
 * 绝不依赖任何全局变量。所有数据访问都经由 datasource.ts 的 OrderDataSource 抽象，
 * 直接连接 SQL Server（ORDER_DB_MSSQL），数据增删改一律在数据库侧完成。
 *
 * 装配顺序：dsh-base → dsh-web-app → 本 Bundle（按 profile 的 bundles 列表）。
 *
 * @module @my-company/biz-order
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { getOrderDataSource } from './datasource.js'
import { resolveTenant } from '@my-company/biz-shared'
import type { OrderStatus } from './types'

const STATUS_VALUES: OrderStatus[] = ['pending', 'paid', 'shipped', 'completed', 'cancelled']

/** 稳定 Cordis 插件名，须与 cordis.patch.yml 中插入行的 `name` 一致。 */
export const name = 'biz-order'

/** 仅依赖 tools 服务（dsh-base 已提供）；声明后 `apply` 才能拿到 `ctx.tools`。 */
export const inject = ['tools']

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

  // —— 工具 1：订单列表（窄字段，强制详情调用才能拿到外键） ——
  ctx.tools.register(defineTool({
    name: 'query_user_orders',
    description:
      '查询当前租户/会话下的订单列表（仅返回 id/标题/状态/金额）。当用户询问订单状态、历史购买记录、'
      + '待付款或已发货订单时使用。返回结果按当前会话隔离，不会跨租户泄露。'
      + '若要下钻客户或库存，需继续调用 query_order_detail 取得 customerId / sku。',
    parameters: {
      status: {
        type: 'string',
        enum: ['pending', 'paid', 'shipped', 'completed', 'cancelled'],
        description: '订单状态筛选；省略则返回全部状态。',
      },
      customerId: {
        type: 'string',
        description: '按客户标识过滤（如 U-1001）；省略则返回该租户全部客户的订单。',
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
      const tenant = resolveTenant(exec, 'ORDER_TENANT')
      const orders = await ds.listOrders(tenant, {
        status: args.status as OrderStatus | undefined,
        customerId: args.customerId,
        keyword: args.keyword,
      }, args.limit)
      return {
        tenant,
        count: orders.length,
        orders,
        hint: '列表只含 id / 标题 / 状态 / 金额。需要客户、商品或发票信息时，'
          + '请用订单号调用 query_order_detail 取得 customerId / sku / invoiceId。',
      } as any
    },
  }))

  // —— 工具 2：订单详情（返回完整外键，支撑链式下钻） ——
  ctx.tools.register(defineTool({
    name: 'query_order_detail',
    description:
      '根据订单单号查询单笔订单的详情（含 customerId / sku / invoiceId）。'
      + '当用户追问某个具体订单（如 SO-1001）的客户、商品或发票时使用；'
      + '拿到 customerId 后可调 query_user_profile，拿到 sku 后可调 query_inventory 继续下钻。',
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
      const tenant = resolveTenant(exec, 'ORDER_TENANT')
      const orderId = args.order_id ?? ''
      const order = await ds.getOrder(tenant, orderId)
      if (!order) {
        return { tenant, found: false, order_id: orderId } as any
      }
      return {
        tenant,
        found: true,
        order: { ...order },
        links: {
          customer: order.customerId
            ? { nextTool: 'query_user_profile', argument: { customerId: order.customerId } }
            : null,
          inventory: order.sku
            ? { nextTool: 'query_inventory_detail', argument: { sku: order.sku } }
            : null,
          invoice: order.invoiceId
            ? { nextTool: 'query_invoice_detail', argument: { invoice_id: order.invoiceId } }
            : '该订单尚未开票（invoiceId 为 null）',
        },
        hint: 'customerId / sku / invoiceId 这三个外键 query_user_orders 列表不返回，只有本工具提供，可据此继续下钻。',
      } as any
    },
  }))

  // —— 工具 3：履约校验（内部两步链：订单 → 库存，演示多步调用） ——
  ctx.tools.register(defineTool({
    name: 'check_order_fulfillable',
    description:
      '校验某订单是否可履约：先查订单取得其 SKU，再查该 SKU 的库存快照判断可用性。'
      + '当用户问"这笔订单能发货吗 / 有货吗"时调用，返回 fulfillable 与原因。',
    parameters: {
      order_id: {
        type: 'string',
        description: '订单单号，如 SO-1003。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'ORDER_TENANT')
      const orderId = args.order_id ?? ''
      const order = await ds.getOrder(tenant, orderId)
      if (!order) {
        return { tenant, found: false, order_id: orderId } as any
      }
      const stock = await ds.checkStock(order.sku, tenant)
      const fulfillable = stock.available > 0
      return {
        tenant,
        found: true,
        order_id: order.id,
        sku: order.sku,
        customerId: order.customerId,
        stock,
        fulfillable,
        reason: fulfillable
          ? `SKU ${order.sku} 库存可用(${stock.available})，可履约`
          : `SKU ${order.sku} 库存不足(available=${stock.available})，暂不可履约`,
      } as any
    },
  }))

  // —— 工具 4：创建订单（写入闭环：工具 → 数据源 → 数据库） ——
  ctx.tools.register(defineTool({
    name: 'create_order',
    description:
      '在当前租户/会话下新建一笔订单并落库。当用户表达要下单、创建订单、录入新订单时使用。'
      + '单号可省略（自动生成），状态默认 pending。写入后可用 query_user_orders 复查。'
      + '可带 customerId / sku 以打通客户与库存下钻。',
    parameters: {
      title: {
        type: 'string',
        description: '订单标题/名称，必填。',
      },
      amount: {
        type: 'number',
        description: '订单金额，必填，非负数。',
      },
      status: {
        type: 'string',
        enum: STATUS_VALUES,
        description: '初始状态；省略则为 pending。',
      },
      order_id: {
        type: 'string',
        description: '指定的订单单号；省略则自动生成。若与已有单号重复会报错。',
      },
      customerId: {
        type: 'string',
        description: '下单客户标识（外键 → biz-user），如 U-1001。',
      },
      sku: {
        type: 'string',
        description: '主商品 SKU（外键 → biz-inventory），如 SKU-DEV。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'ORDER_TENANT')
      try {
        const order = await ds.createOrder(tenant, {
          id: args.order_id,
          title: String(args.title ?? ''),
          amount: Number(args.amount),
          status: args.status as OrderStatus | undefined,
          customerId: args.customerId,
          sku: args.sku,
        })
        return { ok: true, tenant, order } as any
      } catch (e) {
        // 校验/落库失败都以结构化错误返回，避免把异常抛给模型导致链路中断
        return { ok: false, tenant, error: (e as Error).message } as any
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'update_order_status',
    description:
      '更新一笔订单的状态（如 pending→paid→shipped→completed→cancelled）。'
      + '当订单状态发生变化（付款、发货、收货、取消）时调用。'
      + '订单不存在或状态非法会返回 found:false 或错误。',
    parameters: {
      order_id: { type: 'string', description: '订单单号，如 SO-20260904-A001。' },
      status: {
        type: 'string',
        enum: STATUS_VALUES,
        description: '目标状态。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'ORDER_TENANT')
      const orderId = String(args.order_id ?? '')
      try {
        const order = await ds.updateStatus(tenant, orderId, args.status as OrderStatus)
        if (!order) return { tenant, found: false, order_id: orderId } as any
        return { tenant, found: true, order } as any
      } catch (e) {
        return { tenant, found: false, order_id: orderId, error: (e as Error).message } as any
      }
    },
  }))
}
