/**
 * 订单数据源实现。
 *
 * 当前仅提供 MockOrderDataSource（内存假数据），用于打通插件加载、工具注册与
 * 多租户隔离的验证链路。真实接入时**不要改这里之外的代码**：
 *
 * 1. 新增一个实现 OrderDataSource 的类（如 RestOrderDataSource）；
 * 2. 在下方 getOrderDataSource() 中按环境变量 ORDER_DATASOURCE 选择实现；
 * 3. 凭据从 DSH 凭证服务读取，禁止硬编码。
 *
 * 这样 biz-order 的其余业务工具代码无需改动即可切换到真实中台。
 */

import type { Order, OrderDataSource, OrderFilter, OrderStatus } from './types'

const ALL_STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'completed', 'cancelled']

/** 演示用内存库，按 tenant 分桶。真实部署替换为对中台的受保护调用。 */
const MOCK_DB: Record<string, Order[]> = {
  demo: [
    { id: 'SO-1001', title: '企业版年费', status: 'paid', amount: 12000, createdAt: '2026-08-01', tenant: 'demo' },
    { id: 'SO-1002', title: '咨询实施服务', status: 'shipped', amount: 8000, createdAt: '2026-08-12', tenant: 'demo' },
    { id: 'SO-1003', title: '定制开发包', status: 'pending', amount: 25000, createdAt: '2026-08-20', tenant: 'demo' },
    { id: 'SO-1004', title: '增值运维包', status: 'completed', amount: 6000, createdAt: '2026-07-15', tenant: 'demo' },
  ],
}

class MockOrderDataSource implements OrderDataSource {
  async listOrders(tenant: string, filter?: OrderFilter, limit = 10): Promise<Order[]> {
    const all = MOCK_DB[tenant] ?? []
    let rows = all
    if (filter?.status) rows = rows.filter(o => o.status === filter.status)
    if (filter?.keyword) {
      const kw = filter.keyword.toLowerCase()
      rows = rows.filter(o => o.title.toLowerCase().includes(kw) || o.id.toLowerCase().includes(kw))
    }
    return rows.slice(0, Math.max(1, limit))
  }

  async getOrder(tenant: string, orderId: string): Promise<Order | null> {
    return (MOCK_DB[tenant] ?? []).find(o => o.id === orderId) ?? null
  }

  listStatuses(): readonly OrderStatus[] {
    return ALL_STATUSES
  }
}

let instance: OrderDataSource | null = null

/**
 * 数据源工厂（扩展点）。
 * 通过环境变量 ORDER_DATASOURCE 选择实现；未配置时回退到 mock。
 * 未来接入真实中台时只改这里，业务工具代码不动。
 */
export function getOrderDataSource(): OrderDataSource {
  if (instance) return instance
  // 预留：const kind = process.env.ORDER_DATASOURCE
  // if (kind === 'rest') instance = new RestOrderDataSource(...)
  instance = new MockOrderDataSource()
  return instance
}
