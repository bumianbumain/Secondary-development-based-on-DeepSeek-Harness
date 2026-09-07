/**
 * Microsoft SQL Server 用户数据源实现。
 *
 * 通过 mssql 驱动连接 SQL Server；连接串从环境变量 USER_DB_MSSQL 注入
 * （由启动进程传入，禁止硬编码凭据）。首次查询时惰性建连并初始化表结构
 * （dbo.biz_users），但不写入任何种子数据——数据一律由数据库侧管理。
 *
 * roles 以逗号分隔的 nvarchar 存储（如 'admin,finance'），读取时拆回数组，
 * 与业务模型 UserProfile.roles: UserRole[] 对齐。
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import mssql from 'mssql'
import { getSharedPool } from '@my-company/biz-shared'
import type { AuthResult, CreateUserInput, UpdateUserInput, UserDataSource, UserFilter, UserProfile, UserRole } from './types'

const ALL_ROLES: UserRole[] = ['admin', 'operator', 'viewer', 'finance']
const ACTIVE_STATUSES: UserProfile['status'][] = ['active', 'disabled']

/**
 * 密码哈希格式：`scrypt$<saltHex>$<hashHex>`。无外部依赖（用 node:crypto），
 * 与核心 BrowserAuth 的 HMAC 思路一致——凭证后端自包含、可离线校验。
 */
const SECRET_PREFIX = 'scrypt$'

function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `${SECRET_PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`
}

function verifyPassword(password: string, stored: string): boolean {
  if (!stored.startsWith(SECRET_PREFIX)) return false
  const [_, saltHex, hashHex] = stored.split('$')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, salt, 64)
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}

export class SqlServerUserDataSource implements UserDataSource {
  private pool: mssql.ConnectionPool | null = null

  constructor(private readonly connString: string) {}

  private async getPool(): Promise<mssql.ConnectionPool> {
    if (!this.pool) {
      this.pool = await getSharedPool(this.connString)
      await this.ensureSchema()
    }
    return this.pool
  }

  private async ensureSchema(): Promise<void> {
    const pool = this.pool!
    await pool.request().query(`
      IF OBJECT_ID('dbo.biz_users', 'U') IS NULL
      CREATE TABLE dbo.biz_users (
        id      nvarchar(64)  NOT NULL PRIMARY KEY,
        name    nvarchar(128) NOT NULL,
        email   nvarchar(256) NOT NULL,
        roles   nvarchar(256) NOT NULL,
        status  nvarchar(32)  NOT NULL,
        tenant  nvarchar(128) NOT NULL,
        secret  nvarchar(255) NULL
      );
    `)
    // 老库兼容：新增实例才建表并带 secret 列；已存在的库按需补列（幂等）。
    await pool.request().query(`
      IF COL_LENGTH('dbo.biz_users', 'secret') IS NULL
      ALTER TABLE dbo.biz_users ADD secret nvarchar(255) NULL;
    `)
  }

  async listUsers(tenant: string, filter?: UserFilter, limit = 10): Promise<UserProfile[]> {
    const pool = await this.getPool()
    const req = pool.request().input('tenant', mssql.NVarChar, tenant)
    const clauses: string[] = ['tenant = @tenant']
    if (filter?.role) {
      // roles 存为逗号分隔串，用 '%,role,%' 匹配（前后补 % 覆盖首位/末位）
      req.input('role', mssql.NVarChar, `%${filter.role}%`)
      clauses.push('roles LIKE @role')
    }
    if (filter?.keyword) {
      req.input('kw', mssql.NVarChar, `%${filter.keyword}%`)
      clauses.push('(name LIKE @kw OR email LIKE @kw OR id LIKE @kw)')
    }
    req.input('limit', mssql.Int, Math.max(1, limit))
    const { recordset } = await req.query(
      `SELECT id, name, email, roles, status, tenant
       FROM dbo.biz_users
       WHERE ${clauses.join(' AND ')}
       ORDER BY id
       OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`,
    )
    return recordset.map(rowToUser)
  }

  async getUser(tenant: string, userId: string): Promise<UserProfile | null> {
    const pool = await this.getPool()
    const { recordset } = await pool
      .request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('id', mssql.NVarChar, userId)
      .query(
        'SELECT id, name, email, roles, status, tenant FROM dbo.biz_users WHERE tenant = @tenant AND id = @id',
      )
    return recordset[0] ? rowToUser(recordset[0]) : null
  }

  async createUser(tenant: string, input: CreateUserInput): Promise<UserProfile> {
    const pool = await this.getPool()
    const name = String(input.name ?? '').trim()
    if (!name) throw new Error('用户姓名不能为空')
    const email = String(input.email ?? '').trim().toLowerCase()
    if (!email) throw new Error('用户邮箱不能为空')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`邮箱格式不正确：${email}`)

    // 幂等性：同租户下邮箱已存在则拒绝重复创建，返回已有 ID 提示（防 agent 重复 create_user 产生重复档案）
    const dup = await pool
      .request()
      .input('email', mssql.NVarChar, email)
      .input('tenant', mssql.NVarChar, tenant)
      .query('SELECT id FROM dbo.biz_users WHERE email = @email AND tenant = @tenant')
    if (dup.recordset.length > 0) {
      throw new Error(`邮箱 ${email} 已存在（用户 ID ${String(dup.recordset[0].id)}），无需重复创建`)
    }

    const roles = (input.roles ?? ['viewer']).map(r => String(r).trim()).filter(Boolean) as UserRole[]
    if (roles.length === 0) throw new Error('至少需要一个角色')
    for (const r of roles) if (!ALL_ROLES.includes(r)) throw new Error(`不支持的角色：${r}`)

    const status = input.status ?? 'active'
    if (!ACTIVE_STATUSES.includes(status)) throw new Error(`不支持的账号状态：${status}`)

    // 用户 ID：调用方未指定则扫描全局 U-<n> 序列取下一个（id 主键全局唯一，跨租户不撞号）
    const id = input.id?.trim() || await nextUserId(pool)

    try {
      await pool
        .request()
        .input('id', mssql.NVarChar, id)
        .input('name', mssql.NVarChar, name)
        .input('email', mssql.NVarChar, email)
        .input('roles', mssql.NVarChar, roles.join(','))
        .input('status', mssql.NVarChar, status)
        .input('tenant', mssql.NVarChar, tenant)
        .query(
          'INSERT INTO dbo.biz_users (id, name, email, roles, status, tenant) VALUES (@id, @name, @email, @roles, @status, @tenant)',
        )
    } catch (e) {
      // SQL Server 主键冲突错误号 2627 / 2601
      const code = (e as { number?: number }).number
      if (code === 2627 || code === 2601) throw new Error(`用户 ID ${id} 已存在，请换一个`)
      throw e
    }
    return { id, name, email, roles, status, tenant }
  }

  listRoles(): readonly UserRole[] {
    return ALL_ROLES
  }

  async authenticate(username: string, password: string): Promise<AuthResult | null> {
    const pool = await this.getPool()
    const key = String(username ?? '').trim().toLowerCase()
    if (!key || !password) return null
    // 登录键：邮箱（精确，已小写）或用户 ID（精确）。跨租户查，登录不需先知道租户。
    const { recordset } = await pool
      .request()
      .input('email', mssql.NVarChar, key)
      .input('id', mssql.NVarChar, String(username ?? '').trim())
      .query(
        'SELECT id, roles, status, secret FROM dbo.biz_users WHERE email = @email OR id = @id',
      )
    const row = recordset[0]
    if (!row) return null
    if (String(row.status) !== 'active') return null
    const stored = row.secret == null ? '' : String(row.secret)
    if (!stored || !verifyPassword(password, stored)) return null
    return {
      userId: String(row.id),
      roles: String(row.roles).split(',').map(s => s.trim()).filter(Boolean) as UserRole[],
    }
  }

  async setPassword(tenant: string, userId: string, password: string): Promise<boolean> {
    const existing = await this.getUser(tenant, userId)
    if (!existing) return false
    if (!password || password.length < 6) {
      throw new Error('密码长度至少 6 位')
    }
    const pool = await this.getPool()
    await pool
      .request()
      .input('secret', mssql.NVarChar, hashPassword(password))
      .input('id', mssql.NVarChar, userId)
      .input('tenant', mssql.NVarChar, tenant)
      .query('UPDATE dbo.biz_users SET secret = @secret WHERE id = @id AND tenant = @tenant')
    return true
  }

  async updateUser(tenant: string, userId: string, input: UpdateUserInput): Promise<UserProfile | null> {
    const existing = await this.getUser(tenant, userId)
    if (!existing) return null

    const roles = input.roles ?? existing.roles
    if (roles.length === 0) throw new Error('至少需要一个角色')
    for (const r of roles) if (!ALL_ROLES.includes(r)) throw new Error(`不支持的角色：${r}`)

    const status = input.status ?? existing.status
    if (!ACTIVE_STATUSES.includes(status)) throw new Error(`不支持的账号状态：${status}`)

    const pool = await this.getPool()
    await pool
      .request()
      .input('roles', mssql.NVarChar, roles.join(','))
      .input('status', mssql.NVarChar, status)
      .input('id', mssql.NVarChar, userId)
      .input('tenant', mssql.NVarChar, tenant)
      .query('UPDATE dbo.biz_users SET roles = @roles, status = @status WHERE id = @id AND tenant = @tenant')

    return this.getUser(tenant, userId)
  }
}

/** 扫描全局 U-<n> 序列号的最大值并返回下一个（id 为主键需全局唯一，跨租户不冲突）。 */
async function nextUserId(pool: mssql.ConnectionPool): Promise<string> {
  const { recordset } = await pool
    .request()
    .query('SELECT id FROM dbo.biz_users WHERE id LIKE \'U-%\'')
  let max = 0
  for (const r of recordset) {
    const m = /^U-(\d+)$/.exec(String(r.id))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `U-${String(max + 1).padStart(3, '0')}`
}

function rowToUser(r: Record<string, unknown>): UserProfile {
  const status = String(r.status)
  return {
    id: String(r.id),
    name: String(r.name),
    email: String(r.email),
    roles: String(r.roles).split(',').map(s => s.trim()).filter(Boolean) as UserRole[],
    status: (status === 'active' || status === 'disabled' ? status : 'active') as UserProfile['status'],
    tenant: String(r.tenant),
  }
}
