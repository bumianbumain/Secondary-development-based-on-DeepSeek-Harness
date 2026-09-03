/**
 * DSH 数据库只读看板 —— 本地轻量查看 SQL Server 数据。
 *
 * 启动：
 *   node tools/db-board.mjs            # 默认 3099 端口
 *   PORT=4000 node tools/db-board.mjs  # 自定义端口
 *
 * 环境变量（默认已内置本机 SQL Server Express 的 DSH 库，可直接跑）：
 *   ORDER_DB_MSSQL  连接串
 *   PORT            监听端口（默认 3099）
 *
 * 安全约束：只监听 127.0.0.1；SQL 入口仅放行 SELECT / WITH，
 * 且禁止多语句（分号）、禁止 DDL/DML。目的就是「看」，不是「改」。
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mssql from 'mssql'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3099)
const CONN =
  process.env.ORDER_DB_MSSQL ||
  'Server=localhost,1433;Database=DSH;User Id=sa;Password=DsH@Verify2026;TrustServerCertificate=true;Encrypt=true;'

let poolPromise = null
function getPool() {
  if (!poolPromise) {
    const pool = new mssql.ConnectionPool(CONN)
    poolPromise = pool.connect().then((p) => {
      p.on('error', () => { poolPromise = null })
      return p
    }).catch((e) => { poolPromise = null; throw e })
  }
  return poolPromise
}

/** 只允许单条只读查询 */
function assertReadOnly(sql) {
  const s = String(sql || '').trim().replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
  if (!s) throw new Error('SQL 为空')
  if (s.includes(';')) throw new Error('禁止多语句（含分号）')
  const head = s.split(/\s+/)[0].toUpperCase()
  if (head !== 'SELECT' && head !== 'WITH') {
    throw new Error(`只允许 SELECT / WITH 查询，当前开头是 ${head}`)
  }
  const banned = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|EXEC|EXECUTE|MERGE|GRANT|REVOKE|BACKUP|RESTORE)\b/i
  const hit = s.match(banned)
  if (hit) throw new Error(`禁止写操作关键字：${hit[0].toUpperCase()}`)
  return s
}

async function query(sql, params = {}) {
  const pool = await getPool()
  const req = pool.request()
  for (const [k, v] of Object.entries(params)) req.input(k, v)
  const r = await req.query(sql)
  return { rows: r.recordset ?? [], affected: r.rowsAffected?.[0] ?? 0 }
}

const routes = {
  /** 表清单 + 行数 */
  'GET /api/tables': async () =>
    query(`
      SELECT s.name AS [schema], t.name AS [table],
             (SELECT SUM(p.rows) FROM sys.partitions p
              WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS [rows]
      FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
      ORDER BY s.name, t.name`),

  /** 表结构（列定义） */
  'GET /api/columns': async (u) => {
    const t = u.searchParams.get('table')
    if (!t) throw new Error('缺少 table 参数')
    return query(
      `SELECT c.name AS [column], ty.name AS [type], c.max_length AS [len],
              c.is_nullable AS [nullable], c.is_identity AS [identity],
              ISNULL((SELECT TOP 1 1 FROM sys.index_columns ic
                      JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                      WHERE ic.object_id = c.object_id AND ic.column_id = c.column_id
                        AND i.is_primary_key = 1), 0) AS is_pk
       FROM sys.columns c
       JOIN sys.types ty ON ty.user_type_id = c.user_type_id
       WHERE c.object_id = OBJECT_ID(@tbl)
       ORDER BY c.column_id`,
      { tbl: t },
    )
  },

  /** 表数据（TOP N，带参数化，表名来自系统表校验） */
  'GET /api/rows': async (u) => {
    const t = u.searchParams.get('table')
    if (!t) throw new Error('缺少 table 参数')
    const limit = Math.min(Number(u.searchParams.get('limit') || 200), 1000)
    // 用 QUOTENAME 生成安全标识符，避免表名拼接注入
    const { rows } = await query('SELECT QUOTENAME(PARSENAME(@n,1)) AS c, QUOTENAME(PARSENAME(@n,2)) AS s', { n: t })
    const [{ s, c }] = rows
    if (!c) throw new Error(`表名无效：${t}`)
    const full = s ? `${s}.${c}` : c
    return query(`SELECT TOP (${limit}) * FROM ${full}`)
  },

  /** 自定义只读查询 */
  'POST /api/query': async (_u, body) => {
    const safe = assertReadOnly(body.sql)
    return query(safe)
  },
}

function json(res, code, data) {
  const s = JSON.stringify(data)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(s)
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`)
  try {
    if (u.pathname === '/' || u.pathname === '/index.html') {
      const html = await readFile(path.join(__dirname, 'db-board.html'), 'utf8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(html)
    }
    const key = `${req.method} ${u.pathname}`
    const handler = routes[key]
    if (!handler) return json(res, 404, { error: `未知路由 ${key}` })

    let body = {}
    if (req.method === 'POST') {
      body = JSON.parse(await new Promise((ok, bad) => {
        let d = ''
        req.on('data', (c) => (d += c))
        req.on('end', () => ok(d || '{}'))
        req.on('error', bad)
      }))
    }
    const out = await handler(u, body)
    return json(res, 200, { ok: true, ...out })
  } catch (e) {
    return json(res, 200, { ok: false, error: e.message })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`DSH 数据库看板已启动 → http://127.0.0.1:${PORT}`)
  console.log(`连接目标：${CONN.replace(/Password=[^;]+/, 'Password=****')}`)
})
