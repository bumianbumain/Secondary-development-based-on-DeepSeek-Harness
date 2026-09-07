/**
 * @my-company/account-menu — 企业「账号菜单」Bundle（node 半）
 *
 * 提供两个 HTTP 端点（经 ctx.webServer.register 挂到宿主路由表）：
 *
 *   GET  /api/biz-user/list
 *     - 鉴权：要求已登录且 roles 含 admin
 *     - 返回 { tenant, users: UserProfile[] }，供客户端「加用户」弹窗的"已有用户"列表用
 *
 *   POST /api/biz-user/create
 *     - 鉴权：同上
 *     - body: { name, email, password, roles?, user_id? }
 *     - 调 biz-user 数据源 createUser + setPassword 落库（demo 租户硬编码，dev 演示场景）
 *     - 返回 { ok: true, user } / { ok: false, error }
 *
 * 安全边界：
 *   - sessionIdentity 由 auth-login 提供的 AuthProvider 铸造的会话才带 roles；
 *     launch-token（?token=）铸造的会话 roles=[]，会被本端点 403 拒绝。
 *   - tenant 当前硬编码为 'demo'。生产场景需把 tenant 从 session.userId 派生（多租户）。
 *
 * @module @my-company/account-menu
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthSession } from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { getUserDataSource } from '@my-company/biz-user'

/** 稳定 Cordis 插件名，须与 cordis.patch.yml 中插入行的 `name` 一致。 */
export const name = 'account-menu'

/** 依赖 webServer（注册路由）和 connection（解析 session）。 */
export const inject = ['webServer', 'connection']

/** 当前演示租户。dev 演示场景：与 dev.env 中 USER_DB_MSSQL 指向的 database 一致。 */
const DEMO_TENANT = 'demo'

/** admin 角色常量（与 biz-user 的 UserRole 枚举对齐）。 */
const ADMIN_ROLE = 'admin'

/** 请求体大小上限（加用户表单小）。 */
const CREATE_BODY_LIMIT_BYTES = 1 << 16

/**
 * Bundle 插件入口：注册两个 HTTP 路由并登记资源生命周期。
 */
export function apply(ctx: Context): void {
  // connection 服务的 sessionIdentity 用法与 client-connection 的 /api/session/me 一致。
  const connection = ctx.get('connection') as {
    sessionIdentity: (req: IncomingMessage) => AuthSession | undefined
  }

  ctx.effect(() => ctx.webServer.register(listRoute(connection)), 'account-menu: GET /api/biz-user/list')
  ctx.effect(() => ctx.webServer.register(createRoute(connection)), 'account-menu: POST /api/biz-user/create')
}

/**
 * 鉴权：要求登录态 + admin 角色。
 * - 401：未登录 / 会话过期 / 启动令牌铸造的无身份会话
 * - 403：登录但非 admin
 */
function requireAdmin(
  connection: { sessionIdentity: (req: IncomingMessage) => AuthSession | undefined },
  req: IncomingMessage,
  res: ServerResponse,
): AuthSession | null {
  const session = connection.sessionIdentity(req)
  if (session === undefined || session.userId === '') {
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return null
  }
  if (!Array.isArray(session.roles) || !session.roles.includes(ADMIN_ROLE)) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'forbidden', reason: 'admin role required' }))
    return null
  }
  return session
}

/** Buffer+parse JSON body，溢出或非 JSON 返回 undefined。 */
function readJsonBody(req: IncomingMessage, limitBytes: number): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
      resolve(undefined); return
    }
    const chunks: Buffer[] = []
    let total = 0
    const onData = (chunk: Buffer): void => {
      total += chunk.byteLength
      if (total > limitBytes) {
        req.removeListener('data', onData)
        req.removeListener('end', onEnd)
        resolve(undefined)
        return
      }
      chunks.push(chunk)
    }
    const onEnd = (): void => {
      if (total > limitBytes) { resolve(undefined); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { resolve(undefined) }
    }
    req.on('data', onData)
    req.once('end', onEnd)
  })
}

/** 发送 JSON 响应并 end。 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * GET /api/biz-user/list — 列出 demo 租户下用户。
 * 客户端「加用户」弹窗用它做"已有用户"参考；返回的 user 不带 secret。
 */
function listRoute(
  connection: { sessionIdentity: (req: IncomingMessage) => AuthSession | undefined },
): WebRoute {
  return {
    kind: 'exact',
    path: '/api/biz-user/list',
    handler: async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      if (requireAdmin(connection, req, res) === null) return
      try {
        const ds = getUserDataSource()
        const users = await ds.listUsers(DEMO_TENANT, {}, 100)
        sendJson(res, 200, { tenant: DEMO_TENANT, count: users.length, users })
      } catch (e) {
        sendJson(res, 500, { error: 'list_failed', message: (e as Error).message })
      }
    },
  }
}

interface CreateUserBody {
  name?: unknown
  email?: unknown
  password?: unknown
  roles?: unknown
  user_id?: unknown
}

/**
 * POST /api/biz-user/create — 创建用户并设置初始密码。
 *
 * 流程：
 *   1. 鉴权（admin）
 *   2. 校验 body（name/email 非空、password ≥ 6、email 形如 local@domain）
 *   3. 调 ds.createUser(tenant, info)  → 落库用户档案
 *   4. 调 ds.setPassword(tenant, userId, password) → 落库 scrypt 凭证
 *   5. 返回 { ok:true, user } / { ok:false, error }
 */
function createRoute(
  connection: { sessionIdentity: (req: IncomingMessage) => AuthSession | undefined },
): WebRoute {
  return {
    kind: 'exact',
    path: '/api/biz-user/create',
    handler: async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
      if (requireAdmin(connection, req, res) === null) return
      const body = await readJsonBody(req, CREATE_BODY_LIMIT_BYTES) as CreateUserBody | undefined
      if (body === undefined) { sendJson(res, 400, { ok: false, error: 'invalid_json' }); return }

      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const email = typeof body.email === 'string' ? body.email.trim() : ''
      const password = typeof body.password === 'string' ? body.password : ''
      const userId = typeof body.user_id === 'string' && body.user_id.trim()
        ? body.user_id.trim()
        : undefined
      const roles = Array.isArray(body.roles)
        ? body.roles.filter((r): r is string => typeof r === 'string')
        : ['viewer']

      if (!name) { sendJson(res, 400, { ok: false, error: 'name_required' }); return }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sendJson(res, 400, { ok: false, error: 'invalid_email' }); return
      }
      if (password.length < 6) { sendJson(res, 400, { ok: false, error: 'password_too_short' }); return }

      try {
        const ds = getUserDataSource()
        const user = await ds.createUser(DEMO_TENANT, {
          id: userId,
          name,
          email,
          roles: roles as ('admin' | 'operator' | 'viewer' | 'finance')[],
          status: 'active',
        })
        await ds.setPassword(DEMO_TENANT, user.id, password)
        sendJson(res, 200, { ok: true, tenant: DEMO_TENANT, user })
      } catch (e) {
        sendJson(res, 200, { ok: false, error: 'create_failed', message: (e as Error).message })
      }
    },
  }
}
