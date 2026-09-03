/**
 * 知识库数据源实现（扩展点）。
 *
 * 当前仅提供 MockKnowledgeDataSource（内存假数据），用于演示多 Bundle 扩展流程。
 * 真实接入时**不要改这里之外的代码**：
 * 1. 新增一个实现 KnowledgeDataSource 的类（如 RestKnowledgeDataSource）；
 * 2. 在下方 getKnowledgeDataSource() 中按环境变量 KNOWLEDGE_DATASOURCE 选择实现；
 * 3. 凭据从 DSH 凭证服务读取，禁止硬编码。
 */

import type { KnowledgeCategory, KnowledgeDataSource, KnowledgeDoc, KnowledgeFilter } from './types'
import { SqlServerKnowledgeDataSource } from './datasource.mssql.js'

const ALL_CATEGORIES: KnowledgeCategory[] = ['faq', 'sop', 'product', 'troubleshooting']

/** 演示用内存库，按 tenant 分桶。真实部署替换为对 CMS/文档系统的受保护调用。 */
const MOCK_DB: Record<string, KnowledgeDoc[]> = {
  demo: [
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
  ],
}

class MockKnowledgeDataSource implements KnowledgeDataSource {
  async searchDocs(tenant: string, filter?: KnowledgeFilter, limit = 10): Promise<KnowledgeDoc[]> {
    let rows = MOCK_DB[tenant] ?? []
    if (filter?.category) rows = rows.filter(d => d.category === filter.category)
    if (filter?.tag) rows = rows.filter(d => d.tags.includes(filter.tag as string))
    if (filter?.keyword) {
      const kw = filter.keyword.toLowerCase()
      rows = rows.filter(d =>
        d.title.toLowerCase().includes(kw) ||
        d.content.toLowerCase().includes(kw) ||
        d.tags.some(t => t.toLowerCase().includes(kw)),
      )
    }
    return rows.slice(0, Math.max(1, limit))
  }

  async getDoc(tenant: string, docId: string): Promise<KnowledgeDoc | null> {
    return (MOCK_DB[tenant] ?? []).find(d => d.id === docId) ?? null
  }

  listCategories(): readonly KnowledgeCategory[] {
    return ALL_CATEGORIES
  }

  async listTags(tenant: string): Promise<readonly string[]> {
    const set = new Set((MOCK_DB[tenant] ?? []).flatMap(d => d.tags))
    return Array.from(set)
  }
}

let instance: KnowledgeDataSource | null = null

/**
 * 数据源工厂（扩展点）。
 * 通过环境变量 KNOWLEDGE_DATASOURCE 选择实现；未配置时回退到 mock。
 * 未来接入真实 CMS/文档系统时只改这里，业务工具代码不动。
 */
export function getKnowledgeDataSource(): KnowledgeDataSource {
  if (instance) return instance
  // 真实接入时按环境变量选择实现，业务工具代码不动
  const kind = process.env.KNOWLEDGE_DATASOURCE
  if (kind === 'mssql') instance = new SqlServerKnowledgeDataSource()
  else instance = new MockKnowledgeDataSource()
  return instance
}
