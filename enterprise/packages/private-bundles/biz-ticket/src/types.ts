/**
 * IT 工单业务领域模型。
 * 仅描述数据形状与状态机规则，不依赖任何数据源实现——便于真实中台接入时复用。
 */

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'

export type TicketStatus = 'open' | 'processing' | 'resolved' | 'closed' | 'cancelled'

export interface Ticket {
  id: string
  title: string
  description: string | null
  priority: TicketPriority
  status: TicketStatus
  assignee: string | null
  reporter: string
  /** 归属租户（多租户隔离单元）。 */
  tenant: string
  /** ISO 时间戳；创建后不再变化。 */
  createdAt: string
  /** ISO 时间戳；每次状态变更都刷新。 */
  updatedAt: string
}

export interface TicketFilter {
  status?: TicketStatus
  priority?: TicketPriority
  assignee?: string
  /** 标题/描述关键字模糊匹配。 */
  keyword?: string
}

/** 创建工单的入参：ID 与优先级/状态可省略（分别自动编号、默认 medium / open）。 */
export interface CreateTicketInput {
  /** 工单 ID；省略则由数据源按规则自动生成（如 T-xxx）。 */
  id?: string
  title: string
  description?: string | null
  /** 优先级；省略则默认 'medium'。 */
  priority?: TicketPriority
  assignee?: string | null
  reporter: string
}

/** 指定租户下的工单统计。 */
export interface TicketStats {
  total: number
  byStatus: Record<TicketStatus, number>
}

/**
 * 合法状态流转表：key = 当前状态，value = 允许流转到的状态集合。
 *
 * 定义在契约层（而不是某个数据源实现里），是为了让 mock 与 SQL Server 两个实现
 * import 同一份规则——否则会出现「mock 测试全绿、切到真实数据库行为不一致」
 * 这类最难排查的 bug。
 */
export const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  // 新建：可以开始处理，也可以直接取消
  open: ['processing', 'cancelled'],
  // 处理中：可以标记为已解决，也可以取消
  processing: ['resolved', 'cancelled'],
  // 已解决：验收通过则关闭，验收不通过则打回处理中
  resolved: ['closed', 'processing'],
  // 终态：已关闭不可再变更
  closed: [],
  // 终态：已取消不可再变更
  cancelled: [],
}

/** 判断一次状态流转是否合法。 */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to)
}

/** 数据源契约：所有工单访问都经由该接口，便于 mock ↔ 真实实现切换。 */
export interface TicketDataSource {
  listTickets(tenant: string, filter?: TicketFilter, limit?: number): Promise<Ticket[]>
  getTicket(tenant: string, id: string): Promise<Ticket | null>
  /** 在指定租户下创建工单；ID 重复时抛出错误（由调用方转成友好提示）。 */
  createTicket(tenant: string, input: CreateTicketInput): Promise<Ticket>
  /**
   * 变更工单状态。
   *
   * 三种情况都要抛出 Error（由调用方转成友好提示，不暴露 SQL 细节）：
   *   1. 工单不存在；
   *   2. 工单存在但不属于当前租户（安全惯例：与「不存在」返回同一个错误）；
   *   3. 状态流转非法（如 open → closed、终态再变更）。
   */
  updateTicketStatus(tenant: string, id: string, next: TicketStatus): Promise<Ticket>
  /** 按状态分组计数；必须在数据源层按租户过滤，不能在应用层数。 */
  getStats(tenant: string): Promise<TicketStats>
}
