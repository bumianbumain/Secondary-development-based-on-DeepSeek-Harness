/**
 * 订单业务领域模型。
 * 仅描述数据形状，不依赖任何数据源实现——便于真实中台接入时复用。
 *
 * 优化点（2026-09-04）：为 Order 补上跨域外键 customerId / sku / invoiceId，
 * 打破"数据孤岛"，使模型在拿到订单后能用 query_user_profile(customerId)、
 * query_inventory(sku) 继续下钻，从而形成多轮工具调用链路，而非只能调一次。
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
  /** 下单客户标识（外键 → biz-user）。列表与详情均返回，便于链式查询客户档案。 */
  customerId: string
  /** 主商品 SKU（外键 → biz-inventory）。详情返回，便于链式查询库存。 */
  sku: string
  /** 关联发票号；订单开具发票后回填，未开票为 null。 */
  invoiceId: string | null
}

/**
 * 订单列表项：刻意只暴露 id / title / status / amount 四个窄字段，
 * 不含 customerId / sku / invoiceId。模型若想下钻，必须先调 query_order_detail
 * 取到外键——这正是"列表工具 → 详情工具"链路存在的原因（避免工具只被调一次）。
 */
export interface OrderListItem {
  id: string
  title: string
  status: OrderStatus
  amount: number
}

export interface OrderFilter {
  status?: OrderStatus
  /** 标题关键字模糊匹配。 */
  keyword?: string
  /** 按客户过滤（外键下钻的入口之一）。 */
  customerId?: string
}

/** 创建订单的入参：单号与状态可省略（分别自动编号、默认 pending）。 */
export interface CreateOrderInput {
  /** 业务单号；省略则由数据源按规则自动生成。 */
  id?: string
  title: string
  status?: OrderStatus
  /** 金额，单位与 Order.amount 一致。 */
  amount: number
  /** 下单客户标识（外键 → biz-user）。 */
  customerId?: string
  /** 主商品 SKU（外键 → biz-inventory）。 */
  sku?: string
}

/** 库存快照：check_order_fulfillable 内部在查完订单后据此判断可否履约。 */
export interface StockInfo {
  sku: string
  available: number
  allocated: number
}

/** 数据源契约：所有订单访问都经由该接口，便于 mock ↔ 真实实现切换。 */
export interface OrderDataSource {
  /** 列表仅返回窄字段 OrderListItem，强制详情调用才能拿到外键。 */
  listOrders(tenant: string, filter?: OrderFilter, limit?: number): Promise<OrderListItem[]>
  getOrder(tenant: string, orderId: string): Promise<Order | null>
  listStatuses(): readonly OrderStatus[]
  /** 在指定租户下创建订单；单号重复时抛出错误（由调用方转成友好提示）。 */
  createOrder(tenant: string, input: CreateOrderInput): Promise<Order>
  /** 更新订单状态。返回更新后的订单；订单不存在则返回 null。 */
  updateStatus(tenant: string, orderId: string, status: OrderStatus): Promise<Order | null>
  /** 查询某 SKU 当前库存快照（check_order_fulfillable 的第二步）。 */
  checkStock(sku: string, tenant: string): Promise<StockInfo>
}
