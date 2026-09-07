/**
 * 库存数据源实现（扩展点）。
 *
 * 数据一律来自 SQL Server（SqlServerInventoryDataSource），不在代码里内置任何假数据。
 * 连接串从环境变量 INVENTORY_DB_MSSQL 注入（由启动进程传入，禁止硬编码凭据）。
 *
 * 未来若需接入其他后端（如 WMS/ERP），新增一个实现 InventoryDataSource 的类，
 * 在下方 getInventoryDataSource() 中切换即可，业务工具代码无需改动。
 */

import type {
  InventoryDataSource,
  InventoryFilter,
  InventoryItem,
  InventoryStatusSummary,
  StockStatus,
  WarehouseSummary,
} from './types'
import { SqlServerInventoryDataSource } from './datasource.mssql.js'

let instance: InventoryDataSource | null = null

/**
 * 数据源工厂（扩展点）。
 * 直接返回 SQL Server 实现，连接串由 SqlServerInventoryDataSource 内部读 INVENTORY_DB_MSSQL。
 */
export function getInventoryDataSource(): InventoryDataSource {
  if (instance) return instance
  instance = new SqlServerInventoryDataSource()
  return instance
}
