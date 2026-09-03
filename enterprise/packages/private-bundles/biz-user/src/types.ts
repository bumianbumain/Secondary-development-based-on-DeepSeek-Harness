/**
 * 用户/账户业务领域模型。
 * 仅描述数据形状，不依赖任何数据源实现——便于真实中台接入时复用。
 */

export type UserRole = 'admin' | 'operator' | 'viewer' | 'finance'

export interface UserProfile {
  id: string
  name: string
  email: string
  roles: UserRole[]
  /** 归属租户（多租户隔离单元）。 */
  tenant: string
  status: 'active' | 'disabled'
}

export interface UserFilter {
  role?: UserRole
  /** 姓名/邮箱/ID 关键字模糊匹配。 */
  keyword?: string
}

/** 创建用户的入参：ID 与状态可省略（分别自动编号、默认 active），roles 省略则给最小权限 viewer。 */
export interface CreateUserInput {
  /** 用户 ID；省略则由数据源按规则自动生成（如 U-xxx）。 */
  id?: string
  name: string
  email: string
  /** 角色；省略则默认 ['viewer']（最小权限）。 */
  roles?: UserRole[]
  /** 状态；省略则默认 'active'。 */
  status?: 'active' | 'disabled'
}

/** 数据源契约：所有用户访问都经由该接口，便于 mock ↔ 真实实现切换。 */
export interface UserDataSource {
  listUsers(tenant: string, filter?: UserFilter, limit?: number): Promise<UserProfile[]>
  getUser(tenant: string, userId: string): Promise<UserProfile | null>
  listRoles(): readonly UserRole[]
  /** 在指定租户下创建用户；ID 重复时抛出错误（由调用方转成友好提示）。 */
  createUser(tenant: string, input: CreateUserInput): Promise<UserProfile>
}
