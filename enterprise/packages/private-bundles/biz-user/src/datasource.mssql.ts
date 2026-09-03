/**
 * Microsoft SQL Server 用户数据源实现。
 *
 * 通过 mssql 驱动连接 SQL Server；连接串从环境变量 USER_DB_MSSQL 注入
 * （由启动进程传入，禁止硬编码凭据）。首次查询时惰性建连并初始化表结构
 * （dbo.biz_users），若 demo 租户为空则写入种子数据，便于直接验证全链路。
 *
 * roles 以逗号分隔的 nvarchar 存储（如 'admin,finance'），读取时拆回数组，
 * 与业务模型 UserProfile.roles: UserRole[] 对齐。该实现与 MockUserDataSource
 * 遵循同一个 UserDataSource 契约，业务工具代码无需改动即可切换（工厂见 datasource.ts）。
 */

import mssql from 'mssql'
import type { CreateUserInput, UserDataSource, UserFilter, UserProfile, UserRole } from './types'

const ALL_ROLES: UserRole[] = ['admin', 'operator', 'viewer', 'finance']
const ACTIVE_STATUSES: UserProfile['status'][] = ['active', 'disabled']

const DEMO_SEED: UserProfile[] = [
  { id: 'U-001', name: '张伟', email: 'zhangwei@demo.com', roles: ['admin'], tenant: 'demo', status: 'active' },
  { id: 'U-002', name: '李娜', email: 'lina@demo.com', roles: ['operator', 'finance'], tenant: 'demo', status: 'active' },
  { id: 'U-003', name: '王强', email: 'wangqiang@demo.com', roles: ['viewer'], tenant: 'demo', status: 'disabled' },
  { id: 'U-004', name: '刘洋', email: 'liuyang@demo.com', roles: ['operator'], tenant: 'demo', status: 'active' },
]

export class SqlServerUserDataSource implements UserDataSource {
  private pool: mssql.ConnectionPool | null = null

  constructor(private readonly connString: string) {}

  private async getPool(): Promise<mssql.ConnectionPool> {
    if (!this.pool) {
      this.pool = new mssql.ConnectionPool(this.connString)
      await this.pool.connect()
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
        tenant  nvarchar(128) NOT NULL
      );
    `)
    const { recordset } = await pool
      .request()
      .query("SELECT COUNT(*) AS c FROM dbo.biz_users WHERE tenant = 'demo'")
    if (Number(recordset[0]?.c ?? 0) === 0) {
      for (const u of DEMO_SEED) {
        await pool
          .request()
          .input('id', mssql.NVarChar, u.id)
          .input('name', mssql.NVarChar, u.name)
          .input('email', mssql.NVarChar, u.email)
          .input('roles', mssql.NVarChar, u.roles.join(','))
          .input('status', mssql.NVarChar, u.status)
          .input('tenant', mssql.NVarChar, u.tenant)
          .query(
            'INSERT INTO dbo.biz_users (id, name, email, roles, status, tenant) VALUES (@id, @name, @email, @roles, @status, @tenant)',
          )
      }
    }
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
