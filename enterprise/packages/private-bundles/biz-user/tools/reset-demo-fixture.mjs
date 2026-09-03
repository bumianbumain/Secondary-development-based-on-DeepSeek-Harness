/**
 * demo 租户夹具复位（P4 集成门禁用）。
 *
 * 背景：biz-user 套件断言「demo 租户恰好 4 条规范种子（U-001..U-004）」是强不变量，
 * 用于捕获 createUser 误写 demo 租户等回归。但开发期 LLM 实跑/人工验证可能向 demo
 * 写入额外行，导致该断言不可复现。本工具在跑套件前把 demo 复位到规范种子：
 *   DELETE dbo.biz_users WHERE tenant='demo' AND id NOT IN (U-001..U-004)
 * 只清理「种子之外」的残留，不动种子本身；若种子行缺失（被人为删改）则报错退出，
 * 交给套件暴露，不做静默修复。
 *
 * 运行：USER_DB_MSSQL="<连接串>" node reset-demo-fixture.mjs
 * 退出码：0=已复位且种子完好  1=种子缺失/表结构异常  2=缺少连接串
 */
import mssql from 'mssql'

const conn = process.env.USER_DB_MSSQL
if (!conn) {
  console.error('[reset-demo-fixture] 缺少 USER_DB_MSSQL 连接串')
  process.exit(2)
}

const SEED_IDS = ['U-001', 'U-002', 'U-003', 'U-004']
const inList = SEED_IDS.map(id => `'${id}'`).join(', ')

const pool = new mssql.ConnectionPool(conn)
await pool.connect()

// 表不存在 → 无需复位（biz-user 套件首次连接时会建表+种子）
const { recordset: chk } = await pool.request()
  .query("SELECT OBJECT_ID('dbo.biz_users', 'U') AS oid")
if (chk[0].oid == null) {
  console.log('[reset-demo-fixture] dbo.biz_users 尚不存在，跳过（套件首连会建表+种子）')
  await pool.close()
  process.exit(0)
}

// 删除 demo 租户中种子之外的残留行
const { rowsAffected } = await pool.request()
  .query(`DELETE FROM dbo.biz_users WHERE tenant = 'demo' AND id NOT IN (${inList})`)
const removed = rowsAffected[0]

// 复位后校验：种子应恰好 4 条且都在
const { recordset } = await pool.request()
  .query("SELECT id FROM dbo.biz_users WHERE tenant = 'demo'")
const remain = recordset.map(r => String(r.id))
const seedOk = SEED_IDS.every(id => remain.includes(id)) && remain.length === SEED_IDS.length
if (!seedOk) {
  console.error(`[reset-demo-fixture] demo 种子不完整！现有 ${remain.length} 条: ${remain.join(', ')}；期望 ${SEED_IDS.join(', ')}`)
  await pool.close()
  process.exit(1)
}

console.log(`[reset-demo-fixture] demo 复位完成：删除残留 ${removed} 条，剩余规范种子 ${remain.length} 条`)
await pool.close()
process.exit(0)
