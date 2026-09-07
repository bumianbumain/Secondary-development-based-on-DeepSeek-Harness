/**
 * @my-company/biz-knowledge — 企业知识库业务 Bundle（测试流程演示）
 *
 * 在不修改 DSH 核心源码的前提下，向工具注册表注入一组知识库查询工具。
 * 多租户隔离基于 exec.agent?.session?.id，数据访问经由 KnowledgeDataSource 抽象。
 *
 * 工具分层（刻意制造信息增量，避免出现「搜索已含全文 → 详情零调用」的死工具）：
 *   search_knowledge             → 只给摘要与定位字段，不含正文全文
 *   query_knowledge_doc          → 完整正文 + 作者/版本/热度/关联文档
 *   summarize_knowledge_by_category → 分类维度实时聚合（非静态枚举）
 *   summarize_knowledge_by_tag      → 标签维度实时聚合（按文档数降序）
 *
 * @module @my-company/biz-knowledge
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { getKnowledgeDataSource } from './datasource.js'
import { resolveTenant } from '@my-company/biz-shared'
import type { KnowledgeCategory, KnowledgeDoc } from './types'

export const name = 'biz-knowledge'
export const inject = ['tools']

/** 搜索结果视图：给摘要而非正文，正文留给详情工具，从而制造下钻动机。 */
function toSearchHit(doc: KnowledgeDoc, keyword?: string) {
  const hasKeyword = !!keyword && keyword.trim().length > 0
  return {
    id: doc.id,
    title: doc.title,
    category: doc.category,
    tags: doc.tags,
    summary: doc.summary,
    updatedAt: doc.updatedAt,
    viewCount: doc.viewCount,
    ...(hasKeyword ? { matchedKeyword: keyword } : {}),
  }
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    return () => {}
  })

  const ds = getKnowledgeDataSource()

  ctx.tools.register(defineTool({
    name: 'search_knowledge',
    description:
      '在当前租户知识库中搜索文档，可按分类、标签或关键字筛选。'
      + '返回的是摘要（不含正文全文），用于定位文档；'
      + '确定要引用的文档后，请用返回的 id 调用 query_knowledge_doc 取得完整正文、作者与版本。',
    parameters: {
      category: {
        type: 'string',
        enum: ['faq', 'sop', 'product', 'troubleshooting'],
        description: '文档分类筛选；省略则返回全部分类。',
      },
      tag: { type: 'string', description: '标签筛选，如"订单"。可用 summarize_knowledge_by_tag 查看全部标签。' },
      keyword: { type: 'string', description: '标题/内容/摘要/标签关键字模糊匹配。' },
      limit: { type: 'number', description: '返回条数上限，默认 10。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'KNOWLEDGE_TENANT')
      const docs = await ds.searchDocs(tenant, {
        category: args.category as KnowledgeCategory | undefined,
        tag: args.tag,
        keyword: args.keyword,
      }, args.limit)
      return {
        tenant,
        count: docs.length,
        docs: docs.map(d => toSearchHit(d, args.keyword)),
        hint: '以上为摘要。需要某篇文档的完整正文，请用其 id 调用 query_knowledge_doc。',
      } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'query_knowledge_doc',
    description:
      '根据文档 ID 查询单篇知识库文档的完整正文，并附作者、版本、浏览量与关联文档。'
      + '当你需要引用原文、确认操作步骤细节或判断文档时效性时使用——'
      + 'search_knowledge 只返回摘要，正文只有本工具提供。',
    parameters: {
      doc_id: { type: 'string', description: '知识库文档 ID，如 KB-1001。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'KNOWLEDGE_TENANT')
      const docId = args.doc_id ?? ''
      const doc = await ds.getDoc(tenant, docId)
      if (!doc) {
        return { tenant, found: false, doc_id: docId } as any
      }
      return {
        tenant,
        found: true,
        doc: { ...doc },
        meta: {
          author: doc.author,
          version: doc.version,
          viewCount: doc.viewCount,
          updatedAt: doc.updatedAt,
          contentLength: doc.content.length,
        },
        related: {
          docIds: doc.relatedDocs,
          hint: doc.relatedDocs.length
            ? '可继续用这些 id 调用 query_knowledge_doc 查看关联文档。'
            : '本文无关联文档。',
        },
      } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'summarize_knowledge_by_category',
    description:
      '按分类聚合当前租户的知识库：给出每个分类下的文档数量与最近更新时间。'
      + '这是实时统计（不是固定枚举），用于知识库盘点与内容新鲜度检查。'
      + '当被问到「知识库各分类有多少文档」「哪类文档最久没更新」时调用本工具。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'KNOWLEDGE_TENANT')
      const rows = await ds.summarizeByCategory(tenant)
      return {
        tenant,
        totalDocs: rows.reduce((s, r) => s + r.docCount, 0),
        byCategory: rows,
        usage: '把 category 字段的值传给 search_knowledge 的 category 参数即可按分类检索。',
      } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'summarize_knowledge_by_tag',
    description:
      '按标签聚合当前租户的知识库：给出每个标签及其文档数量（按数量降序）。'
      + '用途有两个：① 需要按标签检索时，先用本工具取得实际存在的标签名（再传给 search_knowledge 的 tag 参数）；'
      + '② 分析知识库的高频主题分布。当被问到「有哪些标签」「哪个主题文档最多」时调用本工具。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'KNOWLEDGE_TENANT')
      const rows = await ds.summarizeByTag(tenant)
      return {
        tenant,
        tagCount: rows.length,
        tags: rows,
        usage: '把 tag 字段的值传给 search_knowledge 的 tag 参数即可按标签检索。',
      } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_knowledge_doc',
    description:
      '新建一篇知识库文档。当用户要「录入/新增/写一篇知识文档、FAQ、SOP」时调用。'
      + '标题、分类、正文必填；标签、摘要、作者、版本、关联文档可选。',
    parameters: {
      title: { type: 'string', description: '文档标题，必填。' },
      category: {
        type: 'string',
        enum: ['faq', 'sop', 'product', 'troubleshooting'],
        description: '文档分类，必填。',
      },
      content: { type: 'string', description: '文档正文，必填。' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签列表，可选。' },
      summary: { type: 'string', description: '摘要，可选。' },
      author: { type: 'string', description: '作者，可选。' },
      version: { type: 'string', description: '版本号，默认 v1.0。' },
      related_docs: { type: 'array', items: { type: 'string' }, description: '关联文档 ID 列表，可选。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec, 'KNOWLEDGE_TENANT')
      try {
        const doc = await ds.createDoc(tenant, {
          title: String(args.title ?? ''),
          category: args.category as KnowledgeCategory,
          content: String(args.content ?? ''),
          tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
          summary: args.summary,
          author: args.author,
          version: args.version,
          relatedDocs: Array.isArray(args.related_docs) ? args.related_docs.map(String) : undefined,
        })
        return { ok: true, tenant, doc } as any
      } catch (e) {
        return { ok: false, tenant, error: (e as Error).message } as any
      }
    },
  }))
}
