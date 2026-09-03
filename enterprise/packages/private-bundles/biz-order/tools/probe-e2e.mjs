/**
 * biz-order → 真实 SQL Server 全链路验证脚本。
 *
 * 走 getOrderDataSource() 工厂（与 dsh web 同一入口），覆盖：
 * 连接建连、自动建表、种子数据、租户隔离、状态/关键字过滤、limit 截断、单条查询。
 *
 * 用法：
 *   ORDER_DATASOURCE=mssql \
 *   ORDER_DB_MSSQL="Server=localhost,1433;Database=DSH;User Id=sa;Password=xxx;TrustServerCertificate=true;Encrypt=true;" \
 *   node probe-e2e.mjs
 */
import { getOrderDataSource } from '../lib/datasource.js'

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}  ${detail}`)
  }
}

const ds = getOrderDataSource()
console.log('datasource type:', ds.constructor.name)
console.log('')

// 1. 建连 + 自动建表 + 种子数据
console.log('[1] 建连 / 建表 / 种子数据')
const demo = await ds.listOrders('demo')
check('连接成功并返回 demo 订单', demo.length >= 4, `got ${demo.length}`)
check('种子订单金额解析为数字', typeof demo[0]?.amount === 'number' && demo[0].amount > 0)
console.log('')
for (const o of demo) {
  console.log(`       ${o.id} | ${o.title} | ${o.status} | ¥${o.amount} | ${o.createdAt} | tenant=${o.tenant}`)
}
console.log('')

// 2. 租户隔离
console.log('[2] 租户隔离')
const acme = await ds.listOrders('acme')
check('acme 租户只看到自己的数据', acme.length > 0 && acme.every((o) => o.tenant === 'acme'), `got ${acme.length}`)
check('demo 数据不泄漏到 acme', !acme.some((o) => o.id.startsWith('SO-')))
const none = await ds.listOrders('no-such-tenant')
check('不存在的租户返回空', none.length === 0, `got ${none.length}`)
console.log('')

// 3. 跨租户越权取单条
console.log('[3] 越权取单条')
const crossTenant = await ds.getOrder('acme', 'SO-1001')
check('acme 取不到 demo 的 SO-1001', crossTenant === null, String(crossTenant?.id))
const mine = await ds.getOrder('demo', 'SO-1001')
check('demo 能取到 SO-1001', mine?.id === 'SO-1001')
check('不存在的订单返回 null', (await ds.getOrder('demo', 'NOT-EXIST')) === null)
console.log('')

// 4. 过滤
console.log('[4] 过滤能力')
const paid = await ds.listOrders('demo', { status: 'paid' })
check('按 status 过滤', paid.length > 0 && paid.every((o) => o.status === 'paid'), `got ${paid.length}`)
const kw = await ds.listOrders('demo', { keyword: '企业版' })
check('按关键字模糊匹配', kw.length > 0 && kw.every((o) => o.title.includes('企业版') || o.id.includes('企业版')), `got ${kw.length}`)
const comb = await ds.listOrders('demo', { status: 'paid', keyword: '企业版' })
check('status + keyword 组合过滤', comb.length > 0 && comb.every((o) => o.status === 'paid'), `got ${comb.length}`)
console.log('')

// 5. limit 截断
console.log('[5] limit 截断')
const l2 = await ds.listOrders('demo', undefined, 2)
check('limit=2 生效', l2.length === 2, `got ${l2.length}`)
const l1 = await ds.listOrders('demo', undefined, 1)
check('limit=1 生效', l1.length === 1, `got ${l1.length}`)
console.log('')

// 6. 状态枚举
console.log('[6] 状态枚举')
const st = ds.listStatuses()
check('返回 5 种状态', st.length === 5, st.join(','))
console.log('       ' + st.join(', '))
console.log('')

// 7. 注入防护（关键字里塞 SQL 片段不应报错也不应返回全表）
console.log('[7] 参数化查询 / 注入防护')
const inj = await ds.listOrders('demo', { keyword: "'; DROP TABLE dbo.biz_orders; --" })
check('恶意关键字被当作普通字符串（表未被删）', inj.length === 0, `got ${inj.length}`)
const stillThere = await ds.listOrders('demo')
check('表仍然存在且数据完好', stillThere.length >= 4, `got ${stillThere.length}`)

console.log('')
console.log(`========== ${pass} passed, ${fail} failed ==========`)
process.exit(fail === 0 ? 0 : 1)
