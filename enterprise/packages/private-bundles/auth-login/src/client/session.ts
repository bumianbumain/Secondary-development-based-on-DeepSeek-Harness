/**
 * auth-login 浏览器侧的会话访问层：只做两件小事——
 *   1. 探活当前会话（GET /api/session/me，401 = 未登录）；
 *   2. 提交登录（POST /login，成功则服务端已下发 HttpOnly 会话 Cookie）。
 * 两条路径都是同源 fetch，浏览器自动携带/接收会话 Cookie（SameSite=Strict）。
 *
 * 这两个端点由核心 client-connection 注册（inert 401 → 挂上 AuthProvider 后生效），
 * 与后端契约一致，无需在此重复实现鉴权逻辑。
 *
 * @module @my-company/auth-login/client
 */

/** 已认证主体（与后端 AuthSession 对齐）。 */
export interface AuthIdentity {
  readonly userId: string
  readonly roles: string[]
}

function parseIdentity(body: unknown): AuthIdentity {
  const record = (typeof body === 'object' && body !== null ? body : {}) as {
    userId?: unknown
    roles?: unknown
  }
  if (typeof record.userId !== 'string') {
    throw new Error('session 响应缺少 userId')
  }
  const roles = Array.isArray(record.roles)
    ? record.roles.filter((role): role is string => typeof role === 'string')
    : []
  return { userId: record.userId, roles }
}

/** 探活当前会话。未登录返回 null；非 401 的异常状态抛错（由调用方决定如何展示）。 */
export async function fetchIdentity(): Promise<AuthIdentity | null> {
  const res = await fetch('/api/session/me', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`会话探活失败：HTTP ${res.status}`)
  return parseIdentity(await res.json())
}

/** 提交登录。失败抛错（消息可直接展示给用户）；成功返回身份（服务端已下发 Cookie）。 */
export async function submitLogin(username: string, password: string): Promise<AuthIdentity> {
  const res = await fetch('/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (res.status === 401) throw new Error('用户名或密码错误')
  if (!res.ok) throw new Error(`登录失败：HTTP ${res.status}`)
  return parseIdentity(await res.json())
}
