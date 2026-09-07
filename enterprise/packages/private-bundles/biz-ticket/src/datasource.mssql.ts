/**
 * Microsoft SQL Server 工单数据源实现（biz-ticket 专属）。
 *
 * 通过 mssql 驱动连接 SQL Server；连接串从环境变量 TICKET_DB_MSSQL 注入
 * （由启动进程传入，禁止硬编码凭据）。首次查询时惰性建连并初始化表结构
 * （dbo.biz_tickets），但不写入任何种子数据——数据一律由数据库侧管理。
 *
 * 状态机校验复用 types.ts 的 canTransition，保证状态流转一致。
 */

import mssql from 'mssql'
import { getSharedPool } from '@my-company/biz-shared'
import type {
  CreateTicketInput,
  Ticket,
  TicketDataSource,
  TicketFilter,
  TicketPriority,
  TicketStats,
  TicketStatus,
} from './types'
import { canTransition } from './types.js'

const ALL_PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'urgent']
const ALL_STATUSES: TicketStatus[] = ['open', 'processing', 'resolved', 'closed', 'cancelled']

export class SqlServerTicketDataSource implements TicketDataSource {
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
      IF OBJECT_ID('dbo.biz_tickets', 'U') IS NULL
      CREATE TABLE dbo.biz_tickets (
        id         nvarchar(64)  NOT NULL PRIMARY KEY,
        title      nvarchar(256) NOT NULL,
        description nvarchar(max) NULL,
        priority   nvarchar(32)  NOT NULL,
        status     nvarchar(32)  NOT NULL,
        assignee   nvarchar(128) NULL,
        reporter   nvarchar(128) NOT NULL,
        tenant     nvarchar(128) NOT NULL,
        created_at nvarchar(32)  NOT NULL,
        updated_at nvarchar(32)  NOT NULL
      );
    `)
  }

  async listTickets(tenant: string, filter?: TicketFilter, limit = 10): Promise<Ticket[]> {
    const pool = await this.getPool()
    const req = pool.request().input('tenant', mssql.NVarChar, tenant)
    const clauses: string[] = ['tenant = @tenant']
    if (filter?.status) {
      req.input('status', mssql.NVarChar, filter.status)
      clauses.push('status = @status')
    }
    if (filter?.priority) {
      req.input('priority', mssql.NVarChar, filter.priority)
      clauses.push('priority = @priority')
    }
    if (filter?.assignee) {
      req.input('assignee', mssql.NVarChar, filter.assignee)
      clauses.push('assignee = @assignee')
    }
    if (filter?.keyword) {
      req.input('kw', mssql.NVarChar, `%${filter.keyword}%`)
      clauses.push('(title LIKE @kw OR description LIKE @kw OR id LIKE @kw)')
    }
    req.input('limit', mssql.Int, Math.max(1, limit))
    const { recordset } = await req.query(
      `SELECT id, title, description, priority, status, assignee, reporter, tenant, created_at, updated_at
       FROM dbo.biz_tickets
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`,
    )
    return recordset.map(rowToTicket)
  }

  async getTicket(tenant: string, id: string): Promise<Ticket | null> {
    const pool = await this.getPool()
    const { recordset } = await pool
      .request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('id', mssql.NVarChar, id)
      .query(
        'SELECT id, title, description, priority, status, assignee, reporter, tenant, created_at, updated_at '
        + 'FROM dbo.biz_tickets WHERE tenant = @tenant AND id = @id',
      )
    return recordset[0] ? rowToTicket(recordset[0]) : null
  }

  async createTicket(tenant: string, input: CreateTicketInput): Promise<Ticket> {
    const pool = await this.getPool()
    const title = String(input.title ?? '').trim()
    if (!title) throw new Error('工单标题不能为空')
    const reporter = String(input.reporter ?? '').trim()
    if (!reporter) throw new Error('报单人不能为空')
    const priority = input.priority ?? 'medium'
    if (!ALL_PRIORITIES.includes(priority)) throw new Error(`不支持的优先级：${priority}`)
    const id = input.id?.trim() || (await generateTicketId(pool))
    const now = new Date().toISOString()

    try {
      await pool
        .request()
        .input('id', mssql.NVarChar, id)
        .input('title', mssql.NVarChar, title)
        .input('description', mssql.NVarChar, input.description)
        .input('priority', mssql.NVarChar, priority)
        .input('status', mssql.NVarChar, 'open')
        .input('assignee', mssql.NVarChar, input.assignee)
        .input('reporter', mssql.NVarChar, reporter)
        .input('tenant', mssql.NVarChar, tenant)
        .input('created_at', mssql.NVarChar, now)
        .input('updated_at', mssql.NVarChar, now)
        .query(
          'INSERT INTO dbo.biz_tickets (id, title, description, priority, status, assignee, reporter, tenant, created_at, updated_at) '
          + 'VALUES (@id, @title, @description, @priority, @status, @assignee, @reporter, @tenant, @created_at, @updated_at)',
        )
    } catch (e) {
      const code = (e as { number?: number }).number
      if (code === 2627 || code === 2601) throw new Error(`工单 ID ${id} 已存在，请换一个`)
      throw e
    }
    return {
      id, title, description: input.description ?? null, priority, status: 'open',
      assignee: input.assignee ?? null, reporter, tenant, createdAt: now, updatedAt: now,
    }
  }

  async updateTicketStatus(tenant: string, id: string, next: TicketStatus): Promise<Ticket> {
    const pool = await this.getPool()
    const { recordset } = await pool
      .request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('id', mssql.NVarChar, id)
      .query('SELECT status FROM dbo.biz_tickets WHERE tenant = @tenant AND id = @id')
    const cur = recordset[0]
    if (!cur) throw new Error(`工单 ${id} 不存在`)
    const from = cur.status as TicketStatus
    if (!ALL_STATUSES.includes(next)) throw new Error(`不支持的工单状态：${next}`)
    if (!canTransition(from, next)) throw new Error(`工单 ${id} 当前状态为 ${from}，不能变更为 ${next}`)
    const now = new Date().toISOString()
    await pool
      .request()
      .input('status', mssql.NVarChar, next)
      .input('updated_at', mssql.NVarChar, now)
      .input('tenant', mssql.NVarChar, tenant)
      .input('id', mssql.NVarChar, id)
      .query('UPDATE dbo.biz_tickets SET status = @status, updated_at = @updated_at WHERE tenant = @tenant AND id = @id')
    return (await this.getTicket(tenant, id))!
  }

  async getStats(tenant: string): Promise<TicketStats> {
    const pool = await this.getPool()
    const { recordset } = await pool
      .request()
      .input('tenant', mssql.NVarChar, tenant)
      .query('SELECT status, COUNT(*) AS c FROM dbo.biz_tickets WHERE tenant = @tenant GROUP BY status')
    const byStatus: Record<TicketStatus, number> = {
      open: 0, processing: 0, resolved: 0, closed: 0, cancelled: 0,
    }
    let total = 0
    for (const r of recordset) {
      const s = r.status as TicketStatus
      const n = Number(r.c)
      byStatus[s] = (byStatus[s] ?? 0) + n
      total += n
    }
    return { total, byStatus }
  }
}

/** 扫描全局 T-<n> 序列号的最大值并返回下一个（id 为主键需全局唯一，跨租户不冲突）。 */
async function generateTicketId(pool: mssql.ConnectionPool): Promise<string> {
  const { recordset } = await pool.request().query("SELECT id FROM dbo.biz_tickets WHERE id LIKE 'T-%'")
  let max = 0
  for (const r of recordset) {
    const m = /^T-(\d+)$/.exec(String(r.id))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `T-${String(max + 1).padStart(3, '0')}`
}

function rowToTicket(r: Record<string, unknown>): Ticket {
  const description = r.description == null ? null : String(r.description)
  const assignee = r.assignee == null || String(r.assignee).length === 0 ? null : String(r.assignee)
  return {
    id: String(r.id),
    title: String(r.title),
    description,
    priority: r.priority as TicketPriority,
    status: r.status as TicketStatus,
    assignee,
    reporter: String(r.reporter),
    tenant: String(r.tenant),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }
}
