/**
 * biz-knowledge 的 SQL Server 实现。
 *
 * 与 biz-order / biz-user 同一套样板：
 *   惰性建连 → ensureSchema() 自动建表（不存在才建）并 seed demo 种子 → 参数化多租户查询。
 * 通过 getKnowledgeDataSource() 工厂按 KNOWLEDGE_DATASOURCE=mssql 选择本实现，
 * 业务工具代码零改动。连接串读 KNOWLEDGE_DB_MSSQL 环境变量。
 */

import mssql from 'mssql'
import type { KnowledgeCategory, KnowledgeDataSource, KnowledgeDoc, KnowledgeFilter } from './types'

const ALL_CATEGORIES: KnowledgeCategory[] = ['faq', 'sop', 'product', 'troubleshooting']

const CONN = process.env.KNOWLEDGE_DB_MSSQL

/** demo 种子：与 mock 数据源保持一致，便于切换实现时行为可预期。 */
const SEED_DOCS: KnowledgeDoc[] = [
  {
    id: 'KB-1001',
    title: '如何重置账号密码',
    category: 'faq',
    tags: ['账号', '密码', '自助'],
    content: '在登录页点击"忘记密码"，按邮件指引完成重置。',
    updatedAt: '2026-08-20',
    tenant: 'demo',
  },
  {
    id: 'KB-1002',
    title: '订单发货 SOP',
    category: 'sop',
    tags: ['订单', '物流', '运营'],
    content: '1. 确认付款 2. 打印面单 3. 拣货 4. 复核 5. 交接物流。',
    updatedAt: '2026-08-15',
    tenant: 'demo',
  },
  {
    id: 'KB-1003',
    title: '企业版功能清单',
    category: 'product',
    tags: ['产品', '企业版', '功能'],
    content: '支持多租户、审计日志、SSO、私有化部署。',
    updatedAt: '2026-08-10',
    tenant: 'demo',
  },
  {
    id: 'KB-1004',
    title: '摄像头离线排查',
    category: 'troubleshooting',
    tags: ['摄像头', '离线', 'IoT'],
    content: '检查电源、网络、固件版本；必要时长按复位键 5 秒。',
    updatedAt: '2026-08-25',
    tenant: 'demo',
  },
]

let poolPromise: Promise<mssql.ConnectionPool> | null = null

function getPool(): Promise<mssql.ConnectionPool> {
  if (!poolPromise) {
    if (!CONN) throw new Error('KNOWLEDGE_DB_MSSQL 未配置，无法连接 SQL Server')
    poolPromise = new mssql.ConnectionPool(CONN).connect()
  }
  return poolPromise
}

/** 建表（不存在才建）+ 幂等 seed。表结构以 NVARCHAR 为主，中文必须用 NVARCHAR。 */
async function ensureSchema(pool: mssql.ConnectionPool): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID('dbo.biz_knowledge', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.biz_knowledge (
        id         NVARCHAR(32)  NOT NULL PRIMARY KEY,
        title      NVARCHAR(200) NOT NULL,
        category   NVARCHAR(32)  NOT NULL,
        tags       NVARCHAR(200) NOT NULL,        -- 逗号分隔字符串，读回时拆回数组
        content    NVARCHAR(MAX) NOT NULL,
        updatedAt  NVARCHAR(32)  NOT NULL,
        tenant     NVARCHAR(64)  NOT NULL
      );
    END
  `)
  const { recordset } = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.biz_knowledge`)
  if (Number(recordset[0].n) === 0) {
    for (const d of SEED_DOCS) {
      await pool.request()
        .input('id', mssql.NVarChar, d.id)
        .input('title', mssql.NVarChar, d.title)
        .input('category', mssql.NVarChar, d.category)
        .input('tags', mssql.NVarChar, d.tags.join(','))
        .input('content', mssql.NVarChar, d.content)
        .input('updatedAt', mssql.NVarChar, d.updatedAt)
        .input('tenant', mssql.NVarChar, d.tenant)
        .query(`
          INSERT INTO dbo.biz_knowledge (id, title, category, tags, content, updatedAt, tenant)
          VALUES (@id, @title, @category, @tags, @content, @updatedAt, @tenant)
        `)
    }
  }
}

function rowToDoc(row: Record<string, unknown>): KnowledgeDoc {
  return {
    id: String(row.id),
    title: String(row.title),
    category: String(row.category) as KnowledgeCategory,
    tags: String(row.tags).split(',').filter(Boolean),
    content: String(row.content),
    updatedAt: String(row.updatedAt),
    tenant: String(row.tenant),
  }
}

export class SqlServerKnowledgeDataSource implements KnowledgeDataSource {
  async searchDocs(tenant: string, filter?: KnowledgeFilter, limit = 10): Promise<KnowledgeDoc[]> {
    const pool = await getPool()
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
      conds.push('(title LIKE @kw OR content LIKE @kw OR tags LIKE @kw)')
      req.input('kw', mssql.NVarChar, `%${filter.keyword}%`)
    }
    const n = Math.max(1, limit)
    const { recordset } = await req.query(`
      SELECT TOP (${n}) id, title, category, tags, content, updatedAt, tenant
      FROM dbo.biz_knowledge
      WHERE ${conds.join(' AND ')}
      ORDER BY id
    `)
    return recordset.map(rowToDoc)
  }

  async getDoc(tenant: string, docId: string): Promise<KnowledgeDoc | null> {
    const pool = await getPool()
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('id', mssql.NVarChar, docId)
      .query(`
        SELECT id, title, category, tags, content, updatedAt, tenant
        FROM dbo.biz_knowledge
        WHERE tenant = @tenant AND id = @id
      `)
    return recordset[0] ? rowToDoc(recordset[0]) : null
  }

  listCategories(): readonly KnowledgeCategory[] {
    return ALL_CATEGORIES
  }

  async listTags(tenant: string): Promise<readonly string[]> {
    const pool = await getPool()
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .query(`SELECT tags FROM dbo.biz_knowledge WHERE tenant = @tenant`)
    const set = new Set<string>()
    for (const r of recordset) {
      for (const t of String(r.tags).split(',').filter(Boolean)) set.add(t)
    }
    return Array.from(set)
  }
}
