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

import type { UserDataSource, UserFilter, UserProfile, UserRole } from './types'

const ALL_ROLES: UserRole[] = ['admin', 'operator', 'viewer', 'finance']

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

  listRoles(): readonly UserRole[] {
    return ALL_ROLES
  }
}

let instance: UserDataSource | null = null

/**
 * 数据源工厂（扩展点）。
 * 通过环境变量 USER_DATASOURCE 选择实现；未配置时回退到 mock。
 * 未来接入真实中台时只改这里，业务工具代码不动。
 */
export function getUserDataSource(): UserDataSource {
  if (instance) return instance
  // 预留：const kind = process.env.USER_DATASOURCE
  // if (kind === 'rest') instance = new RestUserDataSource(...)
  instance = new MockUserDataSource()
  return instance
}
