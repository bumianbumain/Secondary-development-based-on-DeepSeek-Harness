/**
 * 用户/账户业务领域模型。
 * 仅描述数据形状，不依赖任何数据源实现——便于真实中台接入时复用。
 */

export type UserRole = 'admin' | 'operator' | 'viewer' | 'finance'

/** 登录凭证校验成功后的主体摘要：供核心 AuthProvider 铸造会话 Cookie。 */
export interface AuthResult {
  userId: string
  roles: UserRole[]
}

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

/** 更新用户的入参：仅提供要修改的字段，未提供则保持不变。 */
export interface UpdateUserInput {
  /** 角色；提供则覆盖原角色。 */
  roles?: UserRole[]
  /** 状态；提供则覆盖原状态。 */
  status?: 'active' | 'disabled'
}

/** 数据源契约：所有用户访问都经由该接口，便于 mock ↔ 真实实现切换。 */
export interface UserDataSource {
  listUsers(tenant: string, filter?: UserFilter, limit?: number): Promise<UserProfile[]>
  getUser(tenant: string, userId: string): Promise<UserProfile | null>
  listRoles(): readonly UserRole[]
  /** 在指定租户下创建用户；ID 重复时抛出错误（由调用方转成友好提示）。 */
  createUser(tenant: string, input: CreateUserInput): Promise<UserProfile>
  /** 更新用户角色/状态。返回更新后的用户；用户不存在则返回 null。 */
  updateUser(tenant: string, userId: string, input: UpdateUserInput): Promise<UserProfile | null>

  /**
   * 校验登录凭证（用户名/邮箱 + 密码），成功返回主体与角色，失败（无此账号、
   * 账号禁用、密码缺失或密码错误）返回 null。供核心 AuthProvider 在 /login
   * 处调用，是「外圈登录权限页」的凭证后端。
   */
  authenticate(username: string, password: string): Promise<AuthResult | null>

  /**
   * 为用户设置登录密码（scrypt 加盐哈希后落库）。供运维引导/重置凭证使用。
   * 用户不存在返回 false。
   */
  setPassword(tenant: string, userId: string, password: string): Promise<boolean>
}
