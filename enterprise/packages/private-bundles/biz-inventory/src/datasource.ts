/**
 * 库存数据源实现（扩展点）。
 *
 * 当前仅提供 MockInventoryDataSource（内存假数据），用于演示多 Bundle 扩展流程。
 * 真实接入时**不要改这里之外的代码**：
 * 1. 新增一个实现 InventoryDataSource 的类（如 RestInventoryDataSource）；
 * 2. 在下方 getInventoryDataSource() 中按环境变量 INVENTORY_DATASOURCE 选择实现；
 * 3. 凭据从 DSH 凭证服务读取，禁止硬编码。
 */

import type { InventoryDataSource, InventoryFilter, InventoryItem, StockStatus } from './types'
import { SqlServerInventoryDataSource } from './datasource.mssql.js'

const ALL_STATUSES: StockStatus[] = ['in_stock', 'low_stock', 'out_of_stock', 'reserved']

/** 演示用内存库，按 tenant 分桶。真实部署替换为对 WMS/ERP 的受保护调用。 */
const MOCK_DB: Record<string, InventoryItem[]> = {
  demo: [
    { id: 'INV-1001', sku: 'SKU-A001', name: '智能摄像头 Pro', warehouse: '上海仓', quantity: 120, reserved: 10, status: 'in_stock', tenant: 'demo' },
    { id: 'INV-1002', sku: 'SKU-A002', name: '边缘计算网关', warehouse: '上海仓', quantity: 8, reserved: 2, status: 'low_stock', tenant: 'demo' },
    { id: 'INV-1003', sku: 'SKU-B001', name: '工业传感器套件', warehouse: '深圳仓', quantity: 0, reserved: 0, status: 'out_of_stock', tenant: 'demo' },
    { id: 'INV-1004', sku: 'SKU-B002', name: 'AI 训练服务器', warehouse: '北京仓', quantity: 50, reserved: 50, status: 'reserved', tenant: 'demo' },
  ],
}

class MockInventoryDataSource implements InventoryDataSource {
  async listItems(tenant: string, filter?: InventoryFilter, limit = 10): Promise<InventoryItem[]> {
    let rows = MOCK_DB[tenant] ?? []
    if (filter?.status) rows = rows.filter(i => i.status === filter.status)
    if (filter?.warehouse) rows = rows.filter(i => i.warehouse === filter.warehouse)
    if (filter?.keyword) {
      const kw = filter.keyword.toLowerCase()
      rows = rows.filter(i =>
        i.name.toLowerCase().includes(kw) ||
        i.sku.toLowerCase().includes(kw) ||
        i.id.toLowerCase().includes(kw),
      )
    }
    return rows.slice(0, Math.max(1, limit))
  }

  async getItem(tenant: string, sku: string): Promise<InventoryItem | null> {
    return (MOCK_DB[tenant] ?? []).find(i => i.sku === sku || i.id === sku) ?? null
  }

  async listWarehouses(tenant: string): Promise<readonly string[]> {
    const set = new Set((MOCK_DB[tenant] ?? []).map(i => i.warehouse))
    return Array.from(set)
  }

  listStatuses(): readonly StockStatus[] {
    return ALL_STATUSES
  }
}

let instance: InventoryDataSource | null = null

/**
 * 数据源工厂（扩展点）。
 * 通过环境变量 INVENTORY_DATASOURCE 选择实现；未配置时回退到 mock。
 * 真实接入 WMS/ERP 时只改这里，业务工具代码不动。
 */
export function getInventoryDataSource(): InventoryDataSource {
  if (instance) return instance
  const kind = process.env.INVENTORY_DATASOURCE
  if (kind === 'mssql') instance = new SqlServerInventoryDataSource()
  else instance = new MockInventoryDataSource()
  return instance
}
