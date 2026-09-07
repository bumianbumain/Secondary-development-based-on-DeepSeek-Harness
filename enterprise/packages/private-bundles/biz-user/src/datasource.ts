/**
 * 用户数据源实现（扩展点）。
 *
 * 数据一律来自 SQL Server（SqlServerUserDataSource），不在代码里内置任何假数据。
 * 连接串从环境变量 USER_DB_MSSQL 注入（由启动进程传入，禁止硬编码凭据）。
 *
 * 未来若需接入其他后端（如 REST 中台），新增一个实现 UserDataSource 的类，
 * 在下方 getUserDataSource() 中切换即可，业务工具代码无需改动。
 */

import type { CreateUserInput, UserDataSource, UserFilter, UserProfile, UserRole } from './types'
import { SqlServerUserDataSource } from './datasource.mssql.js'

let instance: UserDataSource | null = null

/**
 * 数据源工厂（扩展点）。
 * 直接返回 SQL Server 实现，连接串读 USER_DB_MSSQL；未配置则抛出明确错误。
 */
export function getUserDataSource(): UserDataSource {
  if (instance) return instance
  const conn = process.env.USER_DB_MSSQL
  if (!conn) throw new Error('USER_DB_MSSQL 未配置，无法连接 SQL Server')
  instance = new SqlServerUserDataSource(conn)
  return instance
}
