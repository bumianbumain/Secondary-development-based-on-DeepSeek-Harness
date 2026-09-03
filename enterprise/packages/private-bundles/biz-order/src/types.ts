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

/** 创建订单的入参：单号与状态可省略（分别自动编号、默认 pending）。 */
export interface CreateOrderInput {
  /** 业务单号；省略则由数据源按规则自动生成。 */
  id?: string
  title: string
  status?: OrderStatus
  /** 金额，单位与 Order.amount 一致。 */
  amount: number
}

/** 数据源契约：所有订单访问都经由该接口，便于 mock ↔ 真实实现切换。 */
export interface OrderDataSource {
  listOrders(tenant: string, filter?: OrderFilter, limit?: number): Promise<Order[]>
  getOrder(tenant: string, orderId: string): Promise<Order | null>
  listStatuses(): readonly OrderStatus[]
  /** 在指定租户下创建订单；单号重复时抛出错误（由调用方转成友好提示）。 */
  createOrder(tenant: string, input: CreateOrderInput): Promise<Order>
}
