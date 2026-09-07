/**
 * 账单/发票数据源实现（扩展点）。
 *
 * 数据一律来自 SQL Server（SqlServerInvoiceDataSource），不在代码里内置任何假数据。
 * 连接串从环境变量 INVOICE_DB_MSSQL 注入（由启动进程传入，禁止硬编码凭据）。
 *
 * 未来若需接入其他后端（如 REST 财务系统），新增一个实现 InvoiceDataSource 的类，
 * 在下方 getInvoiceDataSource() 中切换即可，业务工具代码无需改动。
 */

import type { Invoice, InvoiceDataSource, InvoiceFilter, InvoiceStatus, InvoiceStatusSummary } from './types'
import { SqlServerInvoiceDataSource } from './datasource.mssql.js'

let instance: InvoiceDataSource | null = null

/**
 * 数据源工厂（扩展点）。
 * 直接返回 SQL Server 实现，连接串由 SqlServerInvoiceDataSource 内部读 INVOICE_DB_MSSQL。
 */
export function getInvoiceDataSource(): InvoiceDataSource {
  if (instance) return instance
  instance = new SqlServerInvoiceDataSource()
  return instance
}
