/**
 * 订单业务领域模型。
 * 仅描述数据形状，不依赖任何数据源实现——便于真实中台接入时复用。
 */

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'completed' | 'cancelled'

export interface Order {
  id: string
  title: string
  status: OrderStatus
  amount: number
  /** ISO 日期，仅为演示。 */
  createdAt: string
  /** 归属租户（多租户隔离单元）。 */
  tenant: string
}

export interface OrderFilter {
  status?: OrderStatus
  /** 标题关键字模糊匹配。 */
  keyword?: string
}

/** 数据源契约：所有订单访问都经由该接口，便于 mock ↔ 真实实现切换。 */
export interface OrderDataSource {
  listOrders(tenant: string, filter?: OrderFilter, limit?: number): Promise<Order[]>
  getOrder(tenant: string, orderId: string): Promise<Order | null>
  listStatuses(): readonly OrderStatus[]
}
