/**
 * 知识库业务领域模型。
 * 仅描述数据形状，不依赖数据源实现——便于真实 CMS/文档系统接入时复用。
 */

export type KnowledgeCategory = 'faq' | 'sop' | 'product' | 'troubleshooting'

export interface KnowledgeDoc {
  id: string
  title: string
  category: KnowledgeCategory
  tags: string[]
  content: string
  updatedAt: string
  /** 归属租户（多租户隔离单元）。 */
  tenant: string
}

export interface KnowledgeFilter {
  category?: KnowledgeCategory
  tag?: string
  keyword?: string
}

/** 数据源契约：所有知识库访问都经由该接口，便于 mock ↔ 真实实现切换。 */
export interface KnowledgeDataSource {
  searchDocs(tenant: string, filter?: KnowledgeFilter, limit?: number): Promise<KnowledgeDoc[]>
  getDoc(tenant: string, docId: string): Promise<KnowledgeDoc | null>
  listCategories(): readonly KnowledgeCategory[]
  listTags(tenant: string): readonly string[]
}
