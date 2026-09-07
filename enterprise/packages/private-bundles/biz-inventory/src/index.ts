/**
 * @my-company/biz-inventory — 企业库存业务 Bundle（测试流程演示）
 *
 * 在不修改 DSH 核心源码的前提下，向工具注册表注入一组库存查询工具。
 * 多租户隔离基于 exec.agent?.session?.id，数据访问经由 InventoryDataSource 抽象。
 *
 * 工具分层（刻意制造信息增量，避免出现「列表已含全部字段 → 详情零调用」的死工具）：
 *   query_inventory               → 只给定位字段（不含成本、供应商、库位）
 *   query_inventory_detail        → 完整信息 + 可用量 + 安全库存告警
 *   summarize_inventory_by_warehouse → 仓库维度聚合（含可筛选的仓库名，供 query_inventory 使用）
 *   summarize_inventory_by_status    → 状态维度聚合（实时统计，非静态枚举）
 *
 * @module @my-company/biz-inventory
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { getInventoryDataSource } from './datasource.js'
import { resolveTenant } from '@my-company/biz-shared'
import type { InventoryItem, StockStatus } from './types'

export const name = 'biz-inventory'
export const inject = ['tools']

/** 列表视图：只暴露定位所需字段，成本/供应商/库位留给详情工具。 */
function toSummary(it: InventoryItem) {
  return {
    id: it.id,
    sku: it.sku,
    name: it.name,
    warehouse: it.warehouse,
    quantity: it.quantity,
    reserved: it.reserved,
    available: it.quantity - it.reserved,
    status: it.status,
  }
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    return () => {}
  })

  const ds = getInventoryDataSource()

  ctx.tools.register(defineTool({
    name: 'query_inventory',
    description:
      '查询当前租户下的库存列表，可按状态、仓库或关键字筛选。'
      + '只返回定位字段（SKU、名称、仓库、数量、可用量、状态），不含单位成本、供应商、库位与安全库存；'
      + '需要这些补货/核算信息时，请用返回的 sku 调用 query_inventory_detail。'
      + '若不确定有哪些仓库可供筛选，先调用 summarize_inventory_by_warehouse 获取准确的仓库名。',
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
      const tenant = resolveTenant(exec, 'INVENTORY_TENANT')
      const items = await ds.listItems(tenant, {
        status: args.status as StockStatus | undefined,
        warehouse: args.warehouse,
        keyword: args.keyword,
      }, args.limit)
      return {
        tenant,
        count: items.length,
        items: items.map(toSummary),
        hint: '需要成本、供应商、库位或安全库存信息，请用 sku 调用 query_inventory_detail。',
      } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'query_inventory_detail',
    description:
      '查询单个 SKU 的完整库存详情：库位、单位成本、供应商、安全库存、最近出入库时间，'
      + '并给出可用量与「是否需要补货」的判断。'
      + '当你需要回答「这个货放在哪」「成本多少」「谁供货」「还够不够卖/要不要补货」时使用——'
      + '这些信息 query_inventory 列表不包含。',
    parameters: {
      sku: { type: 'string', description: 'SKU 或库存 ID，如 SKU-A001。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'INVENTORY_TENANT')
      const sku = args.sku ?? ''
      const it = await ds.getItem(tenant, sku)
      if (!it) {
        return { tenant, found: false, sku } as any
      }
      const available = it.quantity - it.reserved
      return {
        tenant,
        found: true,
        item: { ...it },
        stock: {
          available,
          safetyStock: it.safetyStock,
          belowSafetyStock: available < it.safetyStock,
          restockSuggestion: available < it.safetyStock
            ? `可用量 ${available} 低于安全库存 ${it.safetyStock}，建议补货 ${it.safetyStock - available} 单位`
            : '库存充足，无需补货',
          inventoryValue: Number((it.quantity * it.unitCost).toFixed(2)),
        },
      } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'summarize_inventory_by_warehouse',
    description:
      '按仓库聚合当前租户的库存：给出每个仓库的 SKU 数量、库存总量、低库存数与缺货数。'
      + '用途有两个：① 需要按仓库筛选库存时，先用本工具取得准确的仓库名（再传给 query_inventory 的 warehouse 参数）；'
      + '② 排查哪个仓缺货/低库存风险最高。当被问到「各仓库存情况如何」「哪个仓缺货」时调用本工具。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'INVENTORY_TENANT')
      const rows = await ds.summarizeByWarehouse(tenant)
      return {
        tenant,
        warehouseCount: rows.length,
        totalSku: rows.reduce((s, r) => s + r.skuCount, 0),
        totalQuantity: rows.reduce((s, r) => s + r.totalQuantity, 0),
        warehouses: rows,
        usage: '把 warehouse 字段的值传给 query_inventory 的 warehouse 参数即可按仓筛选。',
      } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'summarize_inventory_by_status',
    description:
      '按库存状态聚合当前租户的库存：各状态的 SKU 数量、库存总量与可用量合计。'
      + '这是实时聚合结果（不是固定枚举），用于库存健康度盘点与缺货风险分析。'
      + '当被问到「有多少 SKU 缺货」「可用库存一共多少」「各状态分布如何」时调用本工具。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'INVENTORY_TENANT')
      const rows = await ds.summarizeByStatus(tenant)
      return {
        tenant,
        totalSku: rows.reduce((s, r) => s + r.skuCount, 0),
        totalQuantity: rows.reduce((s, r) => s + r.totalQuantity, 0),
        totalAvailable: rows.reduce((s, r) => s + r.totalAvailable, 0),
        byStatus: rows,
      } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'restock_inventory',
    description:
      '把货物补进库存（入库），增加指定 SKU 的 quantity。'
      + '当用户表示「收到货」「到货」「采购到货」并确认要补进库存时调用。'
      + '重要约定：收货（订单状态变为 completed / 已收货）时，必须先向用户确认「是否补进库存」，'
      + '用户明确同意后再调用本工具，不要未经确认就自动入库。',
    parameters: {
      sku: { type: 'string', description: '要补货的商品 SKU，如 SKU-A002。' },
      quantity: { type: 'number', description: '补货数量，正整数。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'INVENTORY_TENANT')
      try {
        const item = await ds.restock(tenant, String(args.sku ?? ''), Number(args.quantity))
        return {
          ok: true,
          tenant,
          item: { ...item },
          available: item.quantity - item.reserved,
        } as any
      } catch (e) {
        return { ok: false, tenant, error: (e as Error).message } as any
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'deduct_inventory',
    description:
      '扣减库存（出库/领用/发货），减少指定 SKU 的 quantity。'
      + '当用户表示「领用」「出库」「发货」「领走」并确认要扣减库存时调用。'
      + '库存不足会报错，不会扣成负数；SKU 未建档会提示先建档。',
    parameters: {
      sku: { type: 'string', description: '要扣减的商品 SKU，如 SKU-A002。' },
      quantity: { type: 'number', description: '扣减数量，正整数。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'INVENTORY_TENANT')
      try {
        const item = await ds.deduct(tenant, String(args.sku ?? ''), Number(args.quantity))
        return {
          ok: true,
          tenant,
          item: { ...item },
          available: item.quantity - item.reserved,
        } as any
      } catch (e) {
        return { ok: false, tenant, error: (e as Error).message } as any
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_inventory_item',
    description:
      '新建库存档案（建档），录入一个新 SKU 的初始库存。'
      + '当用户要「上架新商品」「录入库存」「建档」「登记新 SKU」时调用。'
      + 'SKU 已建档会报错，不会重复创建。',
    parameters: {
      sku: { type: 'string', description: '商品 SKU，必填，如 SKU-A003。' },
      name: { type: 'string', description: '商品名称，必填。' },
      warehouse: { type: 'string', description: '仓库名称，必填，如"上海仓"。' },
      quantity: { type: 'number', description: '初始库存数量，默认 0。' },
      unitCost: { type: 'number', description: '单位成本，默认 0。' },
      supplier: { type: 'string', description: '供应商名称，可选。' },
      safetyStock: { type: 'number', description: '安全库存阈值，默认 0。' },
      location: { type: 'string', description: '库位编码，可选。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'INVENTORY_TENANT')
      try {
        const item = await ds.createItem(tenant, {
          sku: String(args.sku ?? ''),
          name: String(args.name ?? ''),
          warehouse: String(args.warehouse ?? ''),
          quantity: args.quantity,
          unitCost: args.unitCost,
          supplier: args.supplier,
          safetyStock: args.safetyStock,
          location: args.location,
        })
        return { ok: true, tenant, item: { ...item } } as any
      } catch (e) {
        return { ok: false, tenant, error: (e as Error).message } as any
      }
    },
  }))
}
