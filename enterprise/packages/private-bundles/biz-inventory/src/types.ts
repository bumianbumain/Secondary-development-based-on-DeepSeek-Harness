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
  /** 库位编码，如 A-01-03。列表不返回，仅详情返回。 */
  location: string
  quantity: number
  reserved: number
  status: StockStatus
  /** 单位成本（元）。列表不返回，仅详情返回。 */
  unitCost: number
  /** 供应商名称。列表不返回，仅详情返回。 */
  supplier: string
  /** 安全库存阈值；可用量低于此值即需补货。列表不返回，仅详情返回。 */
  safetyStock: number
  /** 最近一次出入库时间。列表不返回，仅详情返回。 */
  lastStockAt: string
  /** 归属租户（多租户隔离单元）。 */
  tenant: string
}

export interface InventoryFilter {
  status?: StockStatus
  warehouse?: string
  keyword?: string
}

/** 按库存状态的动态聚合——实时统计，不是静态枚举，因此对模型有信息增量。 */
export interface InventoryStatusSummary {
  status: StockStatus
  /** 该状态的 SKU 数量。 */
  skuCount: number
  /** 该状态的库存总量（含预留）。 */
  totalQuantity: number
  /** 该状态的可用量合计（quantity - reserved）。 */
  totalAvailable: number
}

/** 按仓库的动态聚合——同时给出可筛选的仓库名与各仓健康度。 */
export interface WarehouseSummary {
  warehouse: string
  /** 该仓的 SKU 数量。 */
  skuCount: number
  /** 该仓库存总量。 */
  totalQuantity: number
  /** 低库存/缺货的 SKU 数量，用于快速定位风险仓。 */
  lowStockCount: number
  outOfStockCount: number
}

/** 新建库存档案（建档）的入参。 */
export interface CreateInventoryItemInput {
  sku: string
  name: string
  warehouse: string
  /** 初始库存数量，默认 0。 */
  quantity?: number
  /** 库位编码，可选。 */
  location?: string
  /** 单位成本，默认 0。 */
  unitCost?: number
  /** 供应商名称，可选。 */
  supplier?: string
  /** 安全库存阈值，默认 0。 */
  safetyStock?: number
}

/** 数据源契约：所有库存访问都经由该接口，便于 mock ↔ 真实实现切换。 */
export interface InventoryDataSource {
  listItems(tenant: string, filter?: InventoryFilter, limit?: number): Promise<InventoryItem[]>
  getItem(tenant: string, sku: string): Promise<InventoryItem | null>
  /** 列出当前租户下出现过的全部仓库名（去重）。 */
  listWarehouses(tenant: string): Promise<readonly string[]>
  listStatuses(): readonly StockStatus[]
  /** 按状态聚合当前租户的库存分布。 */
  summarizeByStatus(tenant: string): Promise<InventoryStatusSummary[]>
  /** 按仓库聚合当前租户的库存分布与缺货风险。 */
  summarizeByWarehouse(tenant: string): Promise<WarehouseSummary[]>
  /** 入库：把指定 SKU 补进仓库（quantity += 补货数量），返回更新后的库存记录。 */
  restock(tenant: string, sku: string, quantity: number): Promise<InventoryItem>
  /** 出库/扣减：把指定 SKU 的库存减少（quantity -= 扣减数量），库存不足则报错。 */
  deduct(tenant: string, sku: string, quantity: number): Promise<InventoryItem>
  /** 新建库存档案（建档）：录入一个新 SKU 的初始库存。 */
  createItem(tenant: string, input: CreateInventoryItemInput): Promise<InventoryItem>
}
