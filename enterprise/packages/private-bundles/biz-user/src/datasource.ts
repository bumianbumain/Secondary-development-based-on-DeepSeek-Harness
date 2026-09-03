/**
 * 用户数据源实现（扩展点）。
 *
 * 当前仅提供 MockUserDataSource（内存假数据），用于打通插件加载、工具注册与
 * 多租户隔离的验证链路。真实接入时**不要改这里之外的代码**：
 *
 * 1. 新增一个实现 UserDataSource 的类（如 RestUserDataSource）；
 * 2. 在下方 getUserDataSource() 中按环境变量 USER_DATASOURCE 选择实现；
 * 3. 凭据从 DSH 凭证服务读取，禁止硬编码。
 *
 * 这样 biz-user 的其余业务工具代码无需改动即可切换到真实中台。
 */

import type { CreateUserInput, UserDataSource, UserFilter, UserProfile, UserRole } from './types'
import { SqlServerUserDataSource } from './datasource.mssql.js'

const ALL_ROLES: UserRole[] = ['admin', 'operator', 'viewer', 'finance']
const ACTIVE_STATUSES: UserProfile['status'][] = ['active', 'disabled']

/** 演示用内存库，按 tenant 分桶。真实部署替换为对中台的受保护调用。 */
const MOCK_DB: Record<string, UserProfile[]> = {
  demo: [
    { id: 'U-001', name: '张伟', email: 'zhangwei@demo.com', roles: ['admin'], tenant: 'demo', status: 'active' },
    { id: 'U-002', name: '李娜', email: 'lina@demo.com', roles: ['operator', 'finance'], tenant: 'demo', status: 'active' },
    { id: 'U-003', name: '王强', email: 'wangqiang@demo.com', roles: ['viewer'], tenant: 'demo', status: 'disabled' },
    { id: 'U-004', name: '刘洋', email: 'liuyang@demo.com', roles: ['operator'], tenant: 'demo', status: 'active' },
  ],
}

class MockUserDataSource implements UserDataSource {
  async listUsers(tenant: string, filter?: UserFilter, limit = 10): Promise<UserProfile[]> {
    let rows = MOCK_DB[tenant] ?? []
    if (filter?.role) rows = rows.filter(u => u.roles.includes(filter.role as UserRole))
    if (filter?.keyword) {
      const kw = filter.keyword.toLowerCase()
      rows = rows.filter(u =>
        u.name.toLowerCase().includes(kw) ||
        u.email.toLowerCase().includes(kw) ||
        u.id.toLowerCase().includes(kw),
      )
    }
    return rows.slice(0, Math.max(1, limit))
  }

  async getUser(tenant: string, userId: string): Promise<UserProfile | null> {
    return (MOCK_DB[tenant] ?? []).find(u => u.id === userId) ?? null
  }

  async createUser(tenant: string, input: CreateUserInput): Promise<UserProfile> {
    const bucket = MOCK_DB[tenant] ?? (MOCK_DB[tenant] = [])
    const user = buildUser(tenant, input)
    // id 为主键需全局唯一：任何租户下都不可重复
    for (const b of Object.values(MOCK_DB)) if (b.some(u => u.id === user.id)) throw new Error(`用户 ID ${user.id} 已存在，请换一个`)
    bucket.unshift(user)
    return user
  }

  listRoles(): readonly UserRole[] {
    return ALL_ROLES
  }
}

/** 校验入参并生成一个完整用户档案（mock 与真实实现共用校验语义）。 */
function buildUser(tenant: string, input: CreateUserInput): UserProfile {
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('用户姓名不能为空')
  const email = String(input.email ?? '').trim().toLowerCase()
  if (!email) throw new Error('用户邮箱不能为空')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`邮箱格式不正确：${email}`)

  const roles = (input.roles ?? ['viewer']).map(r => String(r).trim()).filter(Boolean) as UserRole[]
  if (roles.length === 0) throw new Error('至少需要一个角色')
  for (const r of roles) if (!ALL_ROLES.includes(r)) throw new Error(`不支持的角色：${r}`)

  const status = input.status ?? 'active'
  if (!ACTIVE_STATUSES.includes(status)) throw new Error(`不支持的账号状态：${status}`)

  const id = input.id?.trim() || generateUserId()
  return { id, name, email, roles, status, tenant }
}

/** 生成形如 U-005 的下一个可用用户 ID（id 为主键需全局唯一，扫描所有租户桶求最大 +1）。 */
function generateUserId(): string {
  let max = 0
  for (const bucket of Object.values(MOCK_DB)) {
    for (const u of bucket) {
      const m = /^U-(\d+)$/.exec(u.id)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  return `U-${String(max + 1).padStart(3, '0')}`
}

let instance: UserDataSource | null = null

/**
 * 数据源工厂（扩展点）。
 * 通过环境变量 USER_DATASOURCE 选择实现；未配置时回退到 mock。
 * 未来接入真实中台时只改这里，业务工具代码不动。
 */
export function getUserDataSource(): UserDataSource {
  if (instance) return instance
  const kind = process.env.USER_DATASOURCE
  if (kind === 'mssql') {
    const conn = process.env.USER_DB_MSSQL
    if (!conn) throw new Error('USER_DATASOURCE=mssql 但未设置 USER_DB_MSSQL 连接串')
    instance = new SqlServerUserDataSource(conn)
    return instance
  }
  instance = new MockUserDataSource()
  return instance
}
