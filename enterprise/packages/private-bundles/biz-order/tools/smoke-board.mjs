const B = 'http://127.0.0.1:3099'
const get = (p) => fetch(B + p).then((r) => r.json())
const post = (p, b) =>
  fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json())

const cases = [
  ['rows', () => get('/api/rows?table=dbo.biz_orders')],
  ['columns', () => get('/api/columns?table=dbo.biz_orders')],
  ['query-ok', () => post('/api/query', { sql: 'SELECT tenant, COUNT(*) AS n, SUM(amount) AS total FROM dbo.biz_orders GROUP BY tenant' })],
  ['query-drop(应拦截)', () => post('/api/query', { sql: 'DROP TABLE dbo.biz_orders' })],
  ['query-多语句(应拦截)', () => post('/api/query', { sql: 'SELECT 1; DELETE FROM dbo.biz_orders' })],
  // 表名里塞注入：期望「不执行注入」，表现为安全报错（Invalid object name）
  ['query-注入表名(应安全拒绝)', () => get('/api/rows?table=dbo.biz_orders;DROP%20TABLE%20x')],
]

let pass = 0
for (const [name, fn] of cases) {
  const j = await fn()
  const shouldBlock = name.includes('应拦截') || name.includes('应安全拒绝')
  const ok = shouldBlock ? j.ok === false : j.ok === true
  if (ok) pass++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} -> ${JSON.stringify(j).slice(0, 220)}`)
}
console.log(`\n${pass}/${cases.length} 通过`)
process.exit(pass === cases.length ? 0 : 1)
