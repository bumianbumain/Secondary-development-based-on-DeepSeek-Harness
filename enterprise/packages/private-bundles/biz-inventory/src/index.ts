/**
 * @my-company/biz-inventory — 企业库存业务 Bundle（测试流程演示）
 *
 * 在不修改 DSH 核心源码的前提下，向工具注册表注入一组库存查询工具。
 * 多租户隔离基于 exec.agent?.session?.id，数据访问经由 InventoryDataSource 抽象。
 *
 * @module @my-company/biz-inventory
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { getInventoryDataSource } from './datasource'
import type { StockStatus } from './types'

export const name = 'biz-inventory'
export const inject = ['tools']

/**
 * 从执行上下文解析租户标识。
 * 有会话时严格按会话隔离；无会话（如 CLI 冒烟测试）回退 'demo' 以打通测试链路。
 * INVENTORY_TENANT 为演示开关：设置后把所有会话固定到指定租户，便于在 UI 里看到种子数据。
 */
function resolveTenant(exec: ToolRunContext): string {
  return process.env.INVENTORY_TENANT || exec.agent?.session?.id || 'demo'
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    return () => {}
  })

  const ds = getInventoryDataSource()

  ctx.tools.register(defineTool({
    name: 'query_inventory',
    description: '查询当前租户下的库存列表，可按状态、仓库或关键字筛选。',
    parameters: {
      status: {
        type: 'string',
        enum: ['in_stock', 'low_stock', 'out_of_stock', 'reserved'],
        description: '库存状态筛选；省略则返回全部。',
      },
      warehouse: { type: 'string', description: '仓库名称筛选，如"上海仓"。' },
      keyword: { type: 'string', description: 'SKU/名称/ID 关键字模糊匹配。' },
      limit: { type: 'number', description: '返回条数上限，默认 10。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec)
      const items = await ds.listItems(tenant, {
        status: args.status as StockStatus | undefined,
        warehouse: args.warehouse,
        keyword: args.keyword,
      }, args.limit)
      return { tenant, count: items.length, items } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'query_inventory_detail',
    description: '根据 SKU 或库存 ID 查询单个库存详情。',
    parameters: {
      sku: { type: 'string', description: 'SKU 或库存 ID，如 SKU-A001。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec)
      const sku = args.sku ?? ''
      const item = await ds.getItem(tenant, sku)
      return item
        ? { tenant, found: true, item } as any
        : { tenant, found: false, sku } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'list_inventory_warehouses',
    description: '列出当前租户下所有仓库名称。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec)
      return { tenant, warehouses: await ds.listWarehouses(tenant) } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'list_inventory_statuses',
    description: '列出系统支持的库存状态枚举。',
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
