/**
 * 知识库数据源实现（扩展点）。
 *
 * 数据一律来自 SQL Server（SqlServerKnowledgeDataSource），不在代码里内置任何假数据。
 * 连接串从环境变量 KNOWLEDGE_DB_MSSQL 注入（由启动进程传入，禁止硬编码凭据）。
 *
 * 未来若需接入其他后端（如 CMS/文档系统），新增一个实现 KnowledgeDataSource 的类，
 * 在下方 getKnowledgeDataSource() 中切换即可，业务工具代码无需改动。
 */

import type {
  KnowledgeCategory,
  KnowledgeCategorySummary,
  KnowledgeDataSource,
  KnowledgeDoc,
  KnowledgeFilter,
  KnowledgeTagSummary,
} from './types'
import { SqlServerKnowledgeDataSource } from './datasource.mssql.js'

let instance: KnowledgeDataSource | null = null

/**
 * 数据源工厂（扩展点）。
 * 直接返回 SQL Server 实现，连接串由 SqlServerKnowledgeDataSource 内部读 KNOWLEDGE_DB_MSSQL。
 */
export function getKnowledgeDataSource(): KnowledgeDataSource {
  if (instance) return instance
  instance = new SqlServerKnowledgeDataSource()
  return instance
}
