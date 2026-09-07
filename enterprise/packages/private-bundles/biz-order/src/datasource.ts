/**
 * 订单数据源实现（扩展点）。
 *
 * 数据一律来自 SQL Server（SqlServerOrderDataSource），不在代码里内置任何假数据。
 * 连接串从环境变量 ORDER_DB_MSSQL 注入（由启动进程传入，禁止硬编码凭据）。
 *
 * 未来若需接入其他后端（如 REST 中台），新增一个实现 OrderDataSource 的类，
 * 在下方 getOrderDataSource() 中切换即可，业务工具代码无需改动。
 */

import type { CreateOrderInput, Order, OrderDataSource, OrderFilter, OrderListItem, OrderStatus, StockInfo } from './types'
import { SqlServerOrderDataSource } from './datasource.mssql.js'

let instance: OrderDataSource | null = null

/**
 * 数据源工厂（扩展点）。
 * 直接返回 SQL Server 实现，连接串读 ORDER_DB_MSSQL；未配置则抛出明确错误。
 */
export function getOrderDataSource(): OrderDataSource {
  if (instance) return instance
  const conn = process.env.ORDER_DB_MSSQL
  if (!conn) throw new Error('ORDER_DB_MSSQL 未配置，无法连接 SQL Server')
  instance = new SqlServerOrderDataSource(conn)
  return instance
}
