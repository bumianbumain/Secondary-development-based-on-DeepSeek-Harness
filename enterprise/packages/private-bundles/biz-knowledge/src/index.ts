/**
 * @my-company/biz-knowledge — 企业知识库业务 Bundle（测试流程演示）
 *
 * 在不修改 DSH 核心源码的前提下，向工具注册表注入一组知识库查询工具。
 * 多租户隔离基于 exec.agent?.session?.id，数据访问经由 KnowledgeDataSource 抽象。
 *
 * @module @my-company/biz-knowledge
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { getKnowledgeDataSource } from './datasource.js'
import type { KnowledgeCategory } from './types'

export const name = 'biz-knowledge'
export const inject = ['tools']

function resolveTenant(exec: ToolRunContext): string {
  return exec.agent?.session?.id ?? 'demo'
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    return () => {}
  })

  const ds = getKnowledgeDataSource()

  ctx.tools.register(defineTool({
    name: 'search_knowledge',
    description: '在当前租户知识库中搜索文档，可按分类、标签或关键字筛选。',
    parameters: {
      category: {
        type: 'string',
        enum: ['faq', 'sop', 'product', 'troubleshooting'],
        description: '文档分类筛选；省略则返回全部分类。',
      },
      tag: { type: 'string', description: '标签筛选，如"订单"。' },
      keyword: { type: 'string', description: '标题/内容/标签关键字模糊匹配。' },
      limit: { type: 'number', description: '返回条数上限，默认 10。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec)
      const docs = await ds.searchDocs(tenant, {
        category: args.category as KnowledgeCategory | undefined,
        tag: args.tag,
        keyword: args.keyword,
      }, args.limit)
      return { tenant, count: docs.length, docs } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'query_knowledge_doc',
    description: '根据知识库文档 ID 查询单篇详情。',
    parameters: {
      doc_id: { type: 'string', description: '知识库文档 ID，如 KB-1001。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec)
      const docId = args.doc_id ?? ''
      const doc = await ds.getDoc(tenant, docId)
      return doc
        ? { tenant, found: true, doc } as any
        : { tenant, found: false, doc_id: docId } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'list_knowledge_categories',
    description: '列出系统支持的知识库分类枚举。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec: ToolRunContext) {
      return { tenant: resolveTenant(exec), categories: ds.listCategories() } as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'list_knowledge_tags',
    description: '列出当前租户知识库中所有标签。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec)
      return { tenant, tags: ds.listTags(tenant) } as any
    },
  }))
}
