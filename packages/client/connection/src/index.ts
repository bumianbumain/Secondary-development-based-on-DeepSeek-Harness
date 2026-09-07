/** Host HTTP bridge for browser-client RPC. */
import type { Context } from '@deepseek-ai/cordis'
import { type IncomingMessage } from 'node:http'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-credentials'
// Activates the webServer Context merge used below.
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { API_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { BrowserAuth, SIGNIN_PATH } from './browser-auth.ts'
import { HostConnectionService } from './rpc-host.ts'

export type {
  ConnectionFetchMethod,
  ConnectionFetchHandler,
  ConnectionFetchRoute,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRequestRejection,
  ConnectionRpcResult,
  ConnectionTrustRequest,
  ClientRequest,
  HostConnectionHandle,
  HostConnectionFetch,
  HostConnectionRpc,
  RpcMessage,
  ServerResponse,
} from './rpc.ts'
export { RpcId, transportError } from './rpc.ts'
export {
  clientRequestSchema,
  rpcErrorSchema,
  rpcIdSchema,
  rpcMessageSchema,
  rpcResultSchema,
  serverResponseSchema,
} from './rpc-schema.ts'
export { HostConnectionService } from './rpc-host.ts'

/** Public seam types for enterprise bundles that mount an AuthProvider. */
export type {
  AuthCredentials,
  AuthProvider,
  AuthSession,
} from './browser-auth.ts'

export { API_PATH } from './api-path.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection. */
export const inject = ['webServer', 'credentials']

/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by; the Web runtime derives LAN IP literals from an active all-interface
   * bind. An entry that is not a bare, canonical authority fails plugin load.
   */
  trustedHosts?: string[]
  /** Absolute browser-session lifetime in days. Default: 30. */
  cookieMaxAgeDays?: number
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  cookieMaxAgeDays: z.natural().min(1).default(30),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Mounts the API gateway under the browser transport prefix. Every request on
 * the prefix passes the Host/Origin browser-trust fence and persistent browser
 * authentication before dispatch.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export async function apply(ctx: Context, config?: ConnectionConfig): Promise<void> {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const cookieMaxAgeDays = config?.cookieMaxAgeDays ?? 30
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const connection = new HostConnectionService(
    ctx,
    trustedHosts,
    await BrowserAuth.create(ctx.root, ctx.credentials, cookieMaxAgeDays),
  )
  const fetchHandler = connection.createSharedFetchHandler(API_PATH)
  const route: WebRoute = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection)
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      await bridge(req, res, fetchHandler, maxRequestBodyBytes)
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'client-connection: /api route')
  // Credential login and session introspection. Registered unconditionally;
  // both are inert (return 401) until an enterprise AuthProvider is mounted.
  ctx.effect(() => ctx.webServer.register(loginRoute(connection, trustedHosts)), 'client-connection: /login route')
  ctx.effect(() => ctx.webServer.register(sessionRoute(connection, trustedHosts)), 'client-connection: /api/session/me route')
  ctx.effect(() => ctx.webServer.register(signinRoute(connection, trustedHosts)), 'client-connection: /signin route')
  ctx.effect(() => ctx.webServer.register(logoutRoute(connection, trustedHosts)), 'client-connection: /logout route')
  ctx.inject(['attachments'], (attachmentCtx) => {
    assertImageBodyCapacity(attachmentCtx, maxRequestBodyBytes)
  })
}

/** Cap for the /login request body (credentials are small). */
const LOGIN_BODY_LIMIT_BYTES = 1 << 16

/** Buffer and parse a JSON request body up to a byte cap; undefined on overflow or bad JSON. */
function readJsonBody(req: IncomingMessage, limitBytes: number): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    if (req.method !== 'POST') { resolve(undefined); return }
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
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(undefined)
      }
    }
    req.on('data', onData)
    req.once('end', onEnd)
  })
}

/** POST /login — verify credentials via the mounted AuthProvider and set the session cookie. */
function loginRoute(
  connection: HostConnectionService,
  trustedHosts: readonly string[],
): WebRoute {
  return {
    kind: 'exact',
    path: '/login',
    handler: async (req, res) => {
      if (!isTrustedApiRequest(req, trustedHosts)) { res.writeHead(403); res.end('forbidden'); return }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
      const body = await readJsonBody(req, LOGIN_BODY_LIMIT_BYTES) as
        | { username?: unknown; password?: unknown }
        | undefined
      if (body === undefined
        || typeof body.username !== 'string'
        || typeof body.password !== 'string') {
        res.writeHead(400)
        res.end('invalid credentials')
        return
      }
      const result = await connection.login({ username: body.username, password: body.password }, req)
      if (result === null) { res.writeHead(401); res.end('unauthorized'); return }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'set-cookie': result.cookie,
      })
      res.end(JSON.stringify({ userId: result.session.userId, roles: result.session.roles }))
    },
  }
}

/** GET /api/session/me — return the authenticated subject and roles, or 401. */
function sessionRoute(
  connection: HostConnectionService,
  trustedHosts: readonly string[],
): WebRoute {
  return {
    kind: 'exact',
    path: '/api/session/me',
    handler: (req, res) => {
      if (!isTrustedApiRequest(req, trustedHosts)) { res.writeHead(403); res.end('forbidden'); return }
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      const identity = connection.sessionIdentity(req)
      if (identity === undefined) { res.writeHead(401); res.end('unauthorized'); return }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(identity))
    },
  }
}

/**
 * GET /signin — serve the enterprise sign-in page HTML when one is mounted.
 * Authenticated visitors are redirected to `/`; without a mounted page the
 * route 404s (the SPA login gate remains the login surface in that setup).
 */
function signinRoute(
  connection: HostConnectionService,
  trustedHosts: readonly string[],
): WebRoute {
  return {
    kind: 'exact',
    path: SIGNIN_PATH,
    handler: (req, res) => {
      if (!isTrustedApiRequest(req, trustedHosts)) { res.writeHead(403); res.end('forbidden'); return }
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      if (connection.isAuthenticated(req)) {
        res.writeHead(302, { 'cache-control': 'no-store', 'location': '/', 'referrer-policy': 'no-referrer' })
        res.end()
        return
      }
      const html = connection.signinPage
      if (html === undefined) { res.writeHead(404); res.end('not found'); return }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      })
      res.end(html)
    },
  }
}

/**
 * GET /logout — clear the session cookie and land on the sign-in page.
 * Lets a visitor drop an existing session (e.g. a legacy token-minted cookie)
 * without touching browser storage; the sign-in page then becomes the entry.
 */
function logoutRoute(
  connection: HostConnectionService,
  trustedHosts: readonly string[],
): WebRoute {
  return {
    kind: 'exact',
    path: '/logout',
    handler: (req, res) => {
      if (!isTrustedApiRequest(req, trustedHosts)) { res.writeHead(403); res.end('forbidden'); return }
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      const clear = connection.signout(req)
      res.writeHead(302, {
        'cache-control': 'no-store',
        'location': SIGNIN_PATH,
        'referrer-policy': 'no-referrer',
        ...(clear === undefined ? {} : { 'set-cookie': clear }),
      })
      res.end()
    },
  }
}
