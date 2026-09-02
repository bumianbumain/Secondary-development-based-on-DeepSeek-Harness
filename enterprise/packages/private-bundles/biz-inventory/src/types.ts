/**
 * 库存业务领域模型。
 * 仅描述数据形状，不依赖数据源实现——便于真实 WMS/ERP 接入时复用。
 */

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'reserved'

export interface InventoryItem {
  id: string
  sku: string
  name: string
  warehouse: string
  quantity: number
  reserved: number
  status: StockStatus
  /** 归属租户（多租户隔离单元）。 */
  tenant: string
}

export interface InventoryFilter {
  status?: StockStatus
  warehouse?: string
  keyword?: string
}

/** 数据源契约：所有库存访问都经由该接口，便于 mock ↔ 真实实现切换。 */
export interface InventoryDataSource {
  listItems(tenant: string, filter?: InventoryFilter, limit?: number): Promise<InventoryItem[]>
  getItem(tenant: string, sku: string): Promise<InventoryItem | null>
  listWarehouses(tenant: string): readonly string[]
  listStatuses(): readonly StockStatus[]
}
