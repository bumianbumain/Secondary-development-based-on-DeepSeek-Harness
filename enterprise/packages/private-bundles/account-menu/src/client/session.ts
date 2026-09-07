/**
 * client 半 session 工具：
 *   - fetchIdentity：GET /api/session/me → { userId, roles } | null（401 = null）
 *   - createUser：POST /api/biz-user/create → { ok, user?, error?, message? }
 *   - listUsers：GET /api/biz-user/list → { tenant, count, users }
 *
 * 所有调用都带 credentials:'include'，由核心 BrowserAuth cookie 自动携带。
 * 后端 401/403 由调用方处理（fetchIdentity 返 null；createUser/listUsers 抛出）。
 */

export interface Identity {
  userId: string
  roles: string[]
}

export interface UserProfile {
  id: string
  name: string
  email: string
  roles: string[]
  status: 'active' | 'disabled'
  created_at: string
  updated_at: string
}

export function fetchIdentity(): Promise<Identity | null> {
  return fetch('/api/session/me', { credentials: 'include' })
    .then((res) => {
      if (res.status === 401) return null
      if (!res.ok) return null
      return res.json() as Promise<Identity>
    })
    .catch(() => null)
}

export interface CreateUserInput {
  name: string
  email: string
  password: string
  roles?: string[]
  user_id?: string
}

export interface CreateUserResult {
  ok: boolean
  user?: UserProfile
  error?: string
  message?: string
}

export function createUser(input: CreateUserInput): Promise<CreateUserResult> {
  return fetch('/api/biz-user/create', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((res) => {
    if (res.status === 401) throw new Error('未登录')
    if (res.status === 403) throw new Error('需要 admin 角色')
    return res.json() as Promise<CreateUserResult>
  })
}

export function listUsers(): Promise<{ tenant: string; count: number; users: UserProfile[] }> {
  return fetch('/api/biz-user/list', { credentials: 'include' }).then((res) => {
    if (res.status === 401) throw new Error('未登录')
    if (res.status === 403) throw new Error('需要 admin 角色')
    return res.json() as Promise<{ tenant: string; count: number; users: UserProfile[] }>
  })
}
