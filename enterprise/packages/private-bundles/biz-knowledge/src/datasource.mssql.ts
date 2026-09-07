/**
 * biz-knowledge 的 SQL Server 实现。
 *
 * 惰性建连 → ensureSchema() 自动建表（不存在才建）→ 参数化多租户查询。
 * 不写入任何种子数据——数据一律由数据库侧管理。
 * 连接串读 KNOWLEDGE_DB_MSSQL 环境变量。
 */

import mssql from 'mssql'
import { generateBusinessId, getSharedPool } from '@my-company/biz-shared'
import type {
  CreateKnowledgeDocInput,
  KnowledgeCategory,
  KnowledgeCategorySummary,
  KnowledgeDataSource,
  KnowledgeDoc,
  KnowledgeFilter,
  KnowledgeTagSummary,
} from './types'

const ALL_CATEGORIES: KnowledgeCategory[] = ['faq', 'sop', 'product', 'troubleshooting']

const CONN = process.env.KNOWLEDGE_DB_MSSQL!

let poolPromise: Promise<mssql.ConnectionPool> | null = null

function getPool(): Promise<mssql.ConnectionPool> {
  if (!poolPromise) {
    if (!CONN) throw new Error('KNOWLEDGE_DB_MSSQL 未配置，无法连接 SQL Server')
    poolPromise = new mssql.ConnectionPool(CONN).connect()
  }
  return poolPromise
}

/** 建表（不存在才建）。表结构以 NVARCHAR 为主，中文必须用 NVARCHAR。 */
async function ensureSchema(pool: mssql.ConnectionPool): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID('dbo.biz_knowledge', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.biz_knowledge (
        id           NVARCHAR(32)  NOT NULL PRIMARY KEY,
        title        NVARCHAR(200) NOT NULL,
        category     NVARCHAR(32)  NOT NULL,
        tags         NVARCHAR(200) NOT NULL,        -- 逗号分隔字符串，读回时拆回数组
        content      NVARCHAR(MAX) NOT NULL,        -- 正文，仅详情查询返回
        summary      NVARCHAR(500) NULL,            -- 摘要，搜索列表返回它而非正文
        author       NVARCHAR(64)  NULL,
        version      NVARCHAR(16)  NULL,
        viewCount    INT           NULL DEFAULT 0,
        relatedDocs  NVARCHAR(200) NULL,            -- 逗号分隔的关联文档 ID
        updatedAt    NVARCHAR(32)  NOT NULL,
        tenant       NVARCHAR(64)  NOT NULL
      );
    END
  `)
}

const COLUMNS = 'id, title, category, tags, content, summary, author, version, viewCount, relatedDocs, updatedAt, tenant'

function splitList(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw.split(',').filter(Boolean)
}

function rowToDoc(row: Record<string, unknown>): KnowledgeDoc {
  return {
    id: String(row.id),
    title: String(row.title),
    category: String(row.category) as KnowledgeCategory,
    tags: splitList(row.tags),
    content: String(row.content ?? ''),
    summary: row.summary == null ? '' : String(row.summary),
    author: row.author == null ? '' : String(row.author),
    version: row.version == null ? '' : String(row.version),
    viewCount: Number(row.viewCount ?? 0),
    relatedDocs: splitList(row.relatedDocs),
    updatedAt: String(row.updatedAt),
    tenant: String(row.tenant),
  }
}

export class SqlServerKnowledgeDataSource implements KnowledgeDataSource {
  async searchDocs(tenant: string, filter?: KnowledgeFilter, limit = 10): Promise<KnowledgeDoc[]> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const req = pool.request()
    const conds: string[] = ['tenant = @tenant']
    req.input('tenant', mssql.NVarChar, tenant)
    if (filter?.category) {
      conds.push('category = @category')
      req.input('category', mssql.NVarChar, filter.category)
    }
    if (filter?.tag) {
      // tags 存为逗号分隔串，子串匹配即视为命中该标签
      conds.push('tags LIKE @tag')
      req.input('tag', mssql.NVarChar, `%${filter.tag}%`)
    }
    if (filter?.keyword) {
      conds.push('(title LIKE @kw OR content LIKE @kw OR tags LIKE @kw OR summary LIKE @kw)')
      req.input('kw', mssql.NVarChar, `%${filter.keyword}%`)
    }
    const n = Math.max(1, limit)
    const { recordset } = await req.query(`
      SELECT TOP (${n}) ${COLUMNS}
      FROM dbo.biz_knowledge
      WHERE ${conds.join(' AND ')}
      ORDER BY id
    `)
    return recordset.map(rowToDoc)
  }

  async getDoc(tenant: string, docId: string): Promise<KnowledgeDoc | null> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('id', mssql.NVarChar, docId)
      .query(`
        SELECT ${COLUMNS}
        FROM dbo.biz_knowledge
        WHERE tenant = @tenant AND id = @id
      `)
    return recordset[0] ? rowToDoc(recordset[0]) : null
  }

  listCategories(): readonly KnowledgeCategory[] {
    return ALL_CATEGORIES
  }

  async listTags(tenant: string): Promise<readonly string[]> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .query(`SELECT tags FROM dbo.biz_knowledge WHERE tenant = @tenant`)
    const set = new Set<string>()
    for (const r of recordset) {
      for (const t of splitList(r.tags)) set.add(t)
    }
    return Array.from(set)
  }

  /** 用 GROUP BY 让数据库算分布；updatedAt 为 ISO 串，MAX 即最近更新。 */
  async summarizeByCategory(tenant: string): Promise<KnowledgeCategorySummary[]> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .query(`
        SELECT category, COUNT(*) AS docCount, MAX(updatedAt) AS latestUpdatedAt
        FROM dbo.biz_knowledge
        WHERE tenant = @tenant
        GROUP BY category
      `)
    const map = new Map<string, KnowledgeCategorySummary>()
    for (const row of recordset as Array<Record<string, unknown>>) {
      map.set(String(row.category), {
        category: String(row.category) as KnowledgeCategory,
        docCount: Number(row.docCount ?? 0),
        latestUpdatedAt: row.latestUpdatedAt == null ? null : String(row.latestUpdatedAt),
      })
    }
    // 补齐空分类，保证返回结构稳定
    return ALL_CATEGORIES.map(category => map.get(category) ?? {
      category, docCount: 0, latestUpdatedAt: null,
    })
  }

  /**
   * 标签存在逗号分隔串里，直接拆串聚合比依赖 STRING_SPLIT 更稳妥（避免版本兼容问题），
   * 且知识库单租户文档量小，拉回内存的代价可忽略。
   */
  async summarizeByTag(tenant: string): Promise<KnowledgeTagSummary[]> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .query(`SELECT tags FROM dbo.biz_knowledge WHERE tenant = @tenant`)
    const counter = new Map<string, number>()
    for (const r of recordset) {
      for (const tag of splitList(r.tags)) counter.set(tag, (counter.get(tag) ?? 0) + 1)
    }
    return Array.from(counter, ([tag, docCount]) => ({ tag, docCount }))
      .sort((a, b) => b.docCount - a.docCount || a.tag.localeCompare(b.tag))
  }

  /** 新建知识文档。 */
  async createDoc(tenant: string, input: CreateKnowledgeDocInput): Promise<KnowledgeDoc> {
    const title = String(input.title ?? '').trim()
    if (!title) throw new Error('文档标题不能为空')
    const content = String(input.content ?? '').trim()
    if (!content) throw new Error('文档正文不能为空')
    if (!ALL_CATEGORIES.includes(input.category)) throw new Error(`不支持的分类：${input.category}`)

    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const id = generateBusinessId('KB')
    const tags = (input.tags ?? []).map(t => String(t).trim()).filter(Boolean)
    const summary = String(input.summary ?? '').trim()
    const author = String(input.author ?? '').trim()
    const version = String(input.version ?? 'v1.0').trim()
    const relatedDocs = (input.relatedDocs ?? []).map(t => String(t).trim()).filter(Boolean)
    const updatedAt = new Date().toISOString().slice(0, 10)

    await pool.request()
      .input('id', mssql.NVarChar, id)
      .input('title', mssql.NVarChar, title)
      .input('category', mssql.NVarChar, input.category)
      .input('tags', mssql.NVarChar, tags.join(','))
      .input('content', mssql.NVarChar, content)
      .input('summary', mssql.NVarChar, summary)
      .input('author', mssql.NVarChar, author)
      .input('version', mssql.NVarChar, version)
      .input('viewCount', mssql.Int, 0)
      .input('relatedDocs', mssql.NVarChar, relatedDocs.join(','))
      .input('updatedAt', mssql.NVarChar, updatedAt)
      .input('tenant', mssql.NVarChar, tenant)
      .query(`
        INSERT INTO dbo.biz_knowledge
          (id, title, category, tags, content, summary, author, version, viewCount, relatedDocs, updatedAt, tenant)
        VALUES
          (@id, @title, @category, @tags, @content, @summary, @author, @version, @viewCount, @relatedDocs, @updatedAt, @tenant)
      `)

    return (await this.getDoc(tenant, id))!
  }
}
