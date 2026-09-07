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
  /** 正文全文。搜索列表不返回它，只有详情查询才返回——这是详情工具的信息增量所在。 */
  content: string
  /** 摘要：搜索结果用摘要代替正文，控制返回体积。 */
  summary: string
  /** 作者/维护人。 */
  author: string
  /** 文档版本。 */
  version: string
  /** 累计浏览次数，用于判断文档热度。 */
  viewCount: number
  /** 关联文档 ID，可继续用 query_knowledge_doc 下钻。 */
  relatedDocs: string[]
  updatedAt: string
  /** 归属租户（多租户隔离单元）。 */
  tenant: string
}

export interface KnowledgeFilter {
  category?: KnowledgeCategory
  tag?: string
  keyword?: string
}

/** 新建知识文档的入参。 */
export interface CreateKnowledgeDocInput {
  title: string
  category: KnowledgeCategory
  content: string
  tags?: string[]
  summary?: string
  author?: string
  version?: string
  relatedDocs?: string[]
}

/** 按分类的动态聚合——含文档数与最近更新时间，是实时统计而非静态枚举。 */
export interface KnowledgeCategorySummary {
  category: KnowledgeCategory
  docCount: number
  /** 该分类下最近一次更新的时间；无文档时为 null。 */
  latestUpdatedAt: string | null
}

/** 按标签的动态聚合——按文档数降序，便于找出高频主题。 */
export interface KnowledgeTagSummary {
  tag: string
  docCount: number
}

/** 数据源契约：所有知识库访问都经由该接口，便于 mock ↔ 真实实现切换。 */
export interface KnowledgeDataSource {
  searchDocs(tenant: string, filter?: KnowledgeFilter, limit?: number): Promise<KnowledgeDoc[]>
  getDoc(tenant: string, docId: string): Promise<KnowledgeDoc | null>
  listCategories(): readonly KnowledgeCategory[]
  /** 列出当前租户知识库中出现的全部标签（去重）。 */
  listTags(tenant: string): Promise<readonly string[]>
  /** 按分类聚合当前租户的文档分布。 */
  summarizeByCategory(tenant: string): Promise<KnowledgeCategorySummary[]>
  /** 按标签聚合当前租户的文档分布（按文档数降序）。 */
  summarizeByTag(tenant: string): Promise<KnowledgeTagSummary[]>
  /** 新建知识文档。 */
  createDoc(tenant: string, input: CreateKnowledgeDocInput): Promise<KnowledgeDoc>
}
