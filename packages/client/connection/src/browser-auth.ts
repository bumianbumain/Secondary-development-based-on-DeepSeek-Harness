/** Browser-session authentication for the Host Connection carrier. */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionTrustRequest,
} from './rpc.ts'

const AUTH_RECORD_KEY = credentialKey('client-connection', 'browser-session')
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const SECRET_BYTES = 32
const TOKEN_QUERY = 'token'

/** Standalone sign-in page path served by the core when the enterprise mounts its HTML. */
export const SIGNIN_PATH = '/signin'
const COOKIE_PREFIX = 'dsh-auth-'
const COOKIE_PAYLOAD_VERSION = 1
const STORED_SECRET_VERSION = 1
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/
const PROCESS_LAUNCH_TOKENS = new WeakMap<object, string>()

interface StoredSecretPayload {
  readonly version: typeof STORED_SECRET_VERSION
  readonly secret: string
}

interface BrowserCookiePayload {
  readonly version: typeof COOKIE_PAYLOAD_VERSION
  readonly authority: string
  readonly issuedAt: number
  readonly expiresAt: number
  /** Authenticated subject; empty for launch-token sessions (no AuthProvider mounted). */
  readonly userId: string
  /** Role claims carried by the session; empty unless an AuthProvider minted it. */
  readonly roles: string[]
}

/** Credential pair a login endpoint verifies. */
export interface AuthCredentials {
  readonly username: string
  readonly password: string
}

/** Authenticated subject and its role claims, returned by a successful login. */
export interface AuthSession {
  readonly userId: string
  readonly roles: string[]
}

/**
 * Pluggable credential verifier. The core `BrowserAuth` calls `verify` on a
 * `/login` POST when one is mounted; a null result means denied. Enterprise
 * bundles supply the concrete implementation (e.g. against a SQL user store) —
 * core never depends on one, so the default single-user launch-token model is
 * untouched when no provider is present.
 */
export interface AuthProvider {
  verify(credentials: AuthCredentials): Promise<AuthSession | null>
}

/** Minimal structural view of the root context's optional AuthProvider slot. */
interface AuthProviderHolder {
  readonly authProvider?: AuthProvider
  /**
   * Optional self-contained sign-in page HTML mounted by an enterprise bundle.
   * When present together with an {@link AuthProvider}, unauthenticated index
   * requests are redirected server-side to `/signin` instead of serving the
   * SPA behind the client-side login gate. When absent the gate behavior is
   * preserved (enterprise bundles that predate the standalone page).
   */
  readonly signinPageHtml?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

function processLaunchToken(owner: object): string {
  const existing = PROCESS_LAUNCH_TOKENS.get(owner)
  if (existing !== undefined) return existing
  const created = encodeBase64Url(randomBytes(SECRET_BYTES))
  PROCESS_LAUNCH_TOKENS.set(owner, created)
  return created
}

function header(
  headers: ConnectionTrustRequest['headers'],
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Canonical request authority used as the cookie name and signed audience. */
function requestAuthority(headers: ConnectionTrustRequest['headers']): string | undefined {
  const host = header(headers, 'host')
  if (host === undefined) return undefined
  try {
    return new URL(`http://${host}`).host
  } catch {
    return undefined
  }
}

function canonicalSecret(value: unknown): Buffer | undefined {
  if (typeof value !== 'string') return undefined
  const decoded = decodeBase64Url(value)
  if (decoded === undefined || decoded.byteLength !== SECRET_BYTES) return undefined
  return decoded
}

function storedSecret(record: CredentialRecord | undefined): Buffer | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || !isRecord(record.payload)
    || record.payload.version !== STORED_SECRET_VERSION) {
    throw new Error('client-connection: browser-session credential record has an unsupported format')
  }
  const secret = canonicalSecret(record.payload.secret)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record has an invalid secret')
  }
  return secret
}

function tokenMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes)
}

function cookieName(authority: string): string {
  return COOKIE_PREFIX + encodeBase64Url(createHash('sha256').update(authority).digest())
}

/** Read the exact generated cookie without implementing general Cookie decoding. */
function cookieValue(headerValue: string, name: string): string | undefined {
  for (const segment of headerValue.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

/** Serialize the fixed browser-session attributes; generated names and values are cookie-safe base64url. */
function sessionCookie(name: string, value: string, expiresAt: number, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`
}

function signature(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest()
}

function encodeCookie(payload: BrowserCookiePayload, secret: Buffer): string {
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `v1.${body}.${encodeBase64Url(signature(secret, body))}`
}

function decodeCookie(value: string, secret: Buffer): BrowserCookiePayload | undefined {
  const parts = value.split('.')
  const [version, body, encodedSignature] = parts
  if (parts.length !== 3 || version !== 'v1' || body === undefined || encodedSignature === undefined) {
    return undefined
  }
  const actualSignature = decodeBase64Url(encodedSignature)
  if (actualSignature === undefined) return undefined
  const expectedSignature = signature(secret, body)
  if (actualSignature.byteLength !== expectedSignature.byteLength
    || !timingSafeEqual(actualSignature, expectedSignature)) return undefined
  let decoded: unknown
  try {
    const bodyBytes = decodeBase64Url(body)
    if (bodyBytes === undefined) return undefined
    decoded = JSON.parse(bodyBytes.toString('utf8'))
  } catch {
    return undefined
  }
  if (!isRecord(decoded)
    || decoded.version !== COOKIE_PAYLOAD_VERSION
    || typeof decoded.authority !== 'string'
    || !Number.isSafeInteger(decoded.issuedAt)
    || !Number.isSafeInteger(decoded.expiresAt)) return undefined
  // userId/roles are absent on cookies minted before the AuthProvider feature;
  // normalize so legacy launch-token sessions read as an empty subject.
  const userId = typeof decoded.userId === 'string' ? decoded.userId : ''
  const roles = Array.isArray(decoded.roles)
    ? decoded.roles.filter((role: unknown): role is string => typeof role === 'string')
    : []
  return {
    version: COOKIE_PAYLOAD_VERSION,
    authority: decoded.authority as string,
    issuedAt: decoded.issuedAt as number,
    expiresAt: decoded.expiresAt as number,
    userId,
    roles,
  }
}

async function initializeSecret(credentials: CredentialProvider): Promise<Buffer> {
  const generated: StoredSecretPayload = {
    version: STORED_SECRET_VERSION,
    secret: encodeBase64Url(randomBytes(SECRET_BYTES)),
  }
  const record = await credentials.modifyRecord(AUTH_RECORD_KEY, (current) => {
    if (current !== undefined) {
      storedSecret(current)
      return Promise.resolve(undefined)
    }
    return Promise.resolve({ kind: 'grant', payload: generated })
  })
  const secret = storedSecret(record)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record was not created')
  }
  return secret
}

/**
 * Process launch-token exchange and persistent signed-cookie verification.
 * Connection loads the credential provider's signing secret during activation
 * and retains it for synchronous request authentication.
 */
export class BrowserAuth {
  private readonly launchToken: string
  private readonly maxAgeMilliseconds: number
  /**
   * The root application context, retained so the mounted enterprise
   * `AuthProvider` (an optional context service) can be resolved lazily at
   * request time. Resolving lazily — rather than capturing the provider at
   * construction — is required because the enterprise bundle that provides it
   * applies after this core plugin and in a sibling plugin branch, so the
   * value is only visible on the root context once the full tree has loaded.
   */
  private readonly rootContext: object

  private constructor(
    processOwner: object,
    private readonly secret: Buffer,
    maxAgeDays: number,
  ) {
    this.launchToken = processLaunchToken(processOwner)
    this.maxAgeMilliseconds = maxAgeDays * DAY_MILLISECONDS
    this.rootContext = processOwner
    if (!Number.isSafeInteger(this.maxAgeMilliseconds)
      || !Number.isSafeInteger(Date.now() + this.maxAgeMilliseconds)) {
      throw new Error('client-connection: cookieMaxAgeDays exceeds the safe timestamp range')
    }
  }

  /**
   * Resolve the enterprise AuthProvider lazily from the root context. Returns
   * undefined when no enterprise bundle has mounted one, preserving the legacy
   * single-user launch-token model.
   */
  private get provider(): AuthProvider | undefined {
    return (this.rootContext as AuthProviderHolder).authProvider
  }

  /**
   * Resolve the enterprise sign-in page HTML lazily from the root context.
   * Undefined when no enterprise bundle has mounted one; the client-side
   * login gate inside the SPA then remains the login surface.
   */
  private get signinHtml(): string | undefined {
    return (this.rootContext as AuthProviderHolder).signinPageHtml
  }

  /**
   * Initialize browser authentication and create its durable signing secret
   * when this Harness home has none.
   * @param processOwner - root application context retaining one token across Connection reloads.
   * @param credentials - persistent credential provider for the Web profile.
   * @param maxAgeDays - positive absolute browser-cookie lifetime in days.
   * @returns initialized authentication owner with the process owner's launch token.
   */
  static async create(
    processOwner: object,
    credentials: CredentialProvider,
    maxAgeDays: number,
  ): Promise<BrowserAuth> {
    return new BrowserAuth(processOwner, await initializeSecret(credentials), maxAgeDays)
  }

  /**
   * Add this process's launch token to the ordinary application root URL.
   * @param baseUrl - canonical browser origin without credentials.
   * @returns root URL carrying the process token as its sole authentication input.
   */
  authenticatedUrl(baseUrl: string): string {
    const url = new URL(baseUrl)
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    url.searchParams.set(TOKEN_QUERY, this.launchToken)
    return url.href
  }

  /**
   * Authenticate an index request. A valid root query token mints the cookie
   * and redirects to clean `/`; a valid cookie lets the caller serve the
   * index; every other request receives the same minimal 401 response.
   * @param req - incoming root or configured-index request.
   * @param res - response owned when this method returns false.
   * @returns true only when the caller may serve index.html.
   */
  authorizeIndex(req: ConnectionIndexRequest, res: ConnectionIndexResponse): boolean {
    /* v8 ignore next -- node:http always supplies url on server requests. */
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const tokens = url.searchParams.getAll(TOKEN_QUERY)
    if (tokens.length > 0) {
      const authority = requestAuthority(req.headers)
      if (req.method === 'GET' && url.pathname === '/' && tokens.length === 1
        && authority !== undefined && tokenMatches(tokens.join(''), this.launchToken)) {
        const issuedAt = Date.now()
        const expiresAt = issuedAt + this.maxAgeMilliseconds
        const value = encodeCookie({
          version: COOKIE_PAYLOAD_VERSION,
          authority,
          issuedAt,
          expiresAt,
          userId: '',
          roles: [],
        }, this.secret)
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': '/',
          'referrer-policy': 'no-referrer',
          'set-cookie': sessionCookie(
            cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1000),
          ),
        })
        res.end()
        return false
      }
      if (req.method === 'GET' && url.pathname === '/' && this.isAuthenticated(req)) {
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': '/',
          'referrer-policy': 'no-referrer',
        })
        res.end()
        return false
      }
      this.writeUnauthorized(req, res)
      return false
    }
    if (this.isAuthenticated(req)) return true
    // When an enterprise sign-in page is mounted, unauthenticated index
    // requests are redirected to it server-side — the SPA is never served to
    // an anonymous visitor. Without the page (or without any provider) the
    // earlier behaviors hold: the SPA login gate renders inside the app, or
    // the legacy single-user launch-token model rejects with 401.
    if (this.provider !== undefined) {
      if (typeof this.signinHtml === 'string' && this.signinHtml.length > 0) {
        res.writeHead(302, {
          'cache-control': 'no-store',
          'location': SIGNIN_PATH,
          'referrer-policy': 'no-referrer',
        })
        res.end()
        return false
      }
      return true
    }
    this.writeUnauthorized(req, res)
    return false
  }

  /**
   * Verify the authority-bound browser cookie on a Host request.
   * @param request - request headers carrying Host and Cookie.
   * @returns true only for an unexpired cookie signed by this activation's loaded secret.
   */
  isAuthenticated(request: ConnectionTrustRequest): boolean {
    return this.validPayload(request) !== undefined
  }

  /** Whether an enterprise AuthProvider is mounted (login flow active). */
  get authEnabled(): boolean {
    return this.provider !== undefined
  }

  /**
   * The enterprise sign-in page HTML, when mounted. The core serves it at
   * {@link SIGNIN_PATH}; undefined keeps the SPA login-gate behavior.
   */
  get signinPage(): string | undefined {
    return this.signinHtml
  }

  /** Decode + validate the authority-bound cookie (shared by isAuthenticated and sessionIdentity). */
  private validPayload(request: ConnectionTrustRequest): BrowserCookiePayload | undefined {
    const authority = requestAuthority(request.headers)
    const rawCookie = header(request.headers, 'cookie')
    if (authority === undefined || rawCookie === undefined) return undefined
    const value = cookieValue(rawCookie, cookieName(authority))
    if (value === undefined) return undefined
    const payload = decodeCookie(value, this.secret)
    if (payload === undefined || payload.authority !== authority) return undefined
    const now = Date.now()
    if (!(payload.issuedAt <= now
      && payload.expiresAt > now
      && payload.expiresAt > payload.issuedAt
      && payload.expiresAt - payload.issuedAt <= this.maxAgeMilliseconds)) return undefined
    return payload
  }

  /**
   * Verify credentials through the mounted {@link AuthProvider} and mint a
   * signed browser-session cookie carrying the subject and roles. Returns null
   * when no provider is mounted or the credentials are rejected.
   * @param credentials - the login pair from the `/login` POST body.
   * @param request - the login request (its Host header binds the cookie name).
   * @returns the set-cookie header value and the session, or null when denied.
   */
  async login(
    credentials: AuthCredentials,
    request: ConnectionTrustRequest,
  ): Promise<{ cookie: string; session: AuthSession } | null> {
    const provider = this.provider
    if (provider === undefined) return null
    const authority = requestAuthority(request.headers)
    if (authority === undefined) return null
    const session = await provider.verify(credentials)
    if (session === null) return null
    const issuedAt = Date.now()
    const expiresAt = issuedAt + this.maxAgeMilliseconds
    const value = encodeCookie({
      version: COOKIE_PAYLOAD_VERSION,
      authority,
      issuedAt,
      expiresAt,
      userId: session.userId,
      roles: session.roles,
    }, this.secret)
    return {
      cookie: sessionCookie(
        cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1000),
      ),
      session,
    }
  }

  /**
   * Resolve the authenticated subject and roles from a valid browser cookie.
   * @param request - request headers carrying Host and Cookie.
   * @returns the session, or undefined when the cookie is absent or invalid.
   */
  sessionIdentity(request: ConnectionTrustRequest): AuthSession | undefined {
    const payload = this.validPayload(request)
    if (payload === undefined) return undefined
    return { userId: payload.userId, roles: payload.roles }
  }

  /**
   * Build a session-cookie clearing header for the request's authority.
   * @param request - request headers carrying Host.
   * @returns the set-cookie value, or undefined without an authority.
   */
  signout(request: ConnectionTrustRequest): string | undefined {
    const authority = requestAuthority(request.headers)
    if (authority === undefined) return undefined
    return `${cookieName(authority)}=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict`
  }

  private writeUnauthorized(req: ConnectionIndexRequest, res: ConnectionIndexResponse): void {
    res.writeHead(401, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    })
    res.end(req.method === 'HEAD'
      ? undefined
      : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
  }
}
