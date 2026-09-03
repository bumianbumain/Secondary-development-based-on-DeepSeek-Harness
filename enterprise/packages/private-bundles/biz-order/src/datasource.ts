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

import type { CreateOrderInput, Order, OrderDataSource, OrderFilter, OrderStatus } from './types'
import { SqlServerOrderDataSource } from './datasource.mssql.js'

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

  async createOrder(tenant: string, input: CreateOrderInput): Promise<Order> {
    const title = String(input.title ?? '').trim()
    if (!title) throw new Error('订单标题不能为空')
    const amount = Number(input.amount)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('订单金额必须是非负数')
    const status = input.status ?? 'pending'
    if (!ALL_STATUSES.includes(status)) throw new Error(`不支持的订单状态：${status}`)

    const bucket = (MOCK_DB[tenant] ??= [])
    const id = input.id?.trim() || `SO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    if (bucket.some(o => o.id === id)) throw new Error(`订单号 ${id} 已存在，请换一个`)

    const order: Order = {
      id,
      title,
      status,
      amount,
      createdAt: new Date().toISOString().slice(0, 10),
      tenant,
    }
    bucket.push(order)
    return order
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
  const kind = process.env.ORDER_DATASOURCE
  if (kind === 'mssql') {
    const conn = process.env.ORDER_DB_MSSQL
    if (!conn) throw new Error('ORDER_DATASOURCE=mssql 但未设置 ORDER_DB_MSSQL 连接串')
    instance = new SqlServerOrderDataSource(conn)
    return instance
  }
  // 预留：if (kind === 'rest') instance = new RestOrderDataSource(...)
  instance = new MockOrderDataSource()
  return instance
}
