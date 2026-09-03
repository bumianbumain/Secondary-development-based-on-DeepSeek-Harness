/**
 * 工具层端到端验证：模拟 dsh 加载 biz-order bundle 并调用注册的业务工具，
 * 验证「工具 → OrderDataSource → SQL Server → UI 返回结构」整条链路。
 *
 * 用法：
 *   ORDER_DATASOURCE=mssql ORDER_DB_MSSQL="..." [ORDER_TENANT=demo] node verify-tool.mjs
 *
 * 不带 ORDER_TENANT 运行时，租户按会话隔离（随机 session id），用于验证隔离语义；
 * 带 ORDER_TENANT=demo 时，所有会话固定到 demo 租户，用于验证 UI 能看到数据。
 */
import { apply } from '../lib/index.js'

// —— 伪造 Cordis Context：捕获注册的插件与工具 ——
const registered = []
const effects = []
const ctx = {
  effect(fn) {
    effects.push(fn)
  },
  tools: {
    register(def) {
      registered.push(def)
    },
  },
}

apply(ctx)

const byName = Object.fromEntries(registered.map((t) => [t.name, t]))
console.log('已注册工具:', Object.keys(byName).join(', '))
console.log('生命周期 effect 数量:', effects.length)
console.log('')

// —— 伪造执行上下文：一个随机会话 id ——
const exec = { agent: { session: { id: 'sess-verify-' + Date.now() } } }
console.log('会话 tenant =', exec.agent.session.id,
  process.env.ORDER_TENANT ? `(ORDER_TENANT=${process.env.ORDER_TENANT} 生效，强制为 demo)` : '(按会话隔离)')
console.log('')

let fail = 0
function check(name, ok, detail = '') {
  console.log(ok ? `  PASS  ${name}` : `  FAIL  ${name}  ${detail}`)
  if (!ok) fail++
}

// 1. query_user_orders
console.log('[1] query_user_orders（列表）')
const listRes = await byName.query_user_orders.execute({}, exec)
console.log('    tenant =', listRes.tenant, '| count =', listRes.count)
for (const o of listRes.orders) {
  console.log(`      ${o.id} | ${o.title} | ${o.status} | ¥${o.amount} | ${o.createdAt}`)
}
// 演示模式下种子数据为 5 条，AI 建单等写入会让它增长，故用「至少」而非精确值
const expectMin = process.env.ORDER_TENANT ? 5 : 0
check(`返回至少 ${expectMin} 条（租户=${listRes.tenant}）`, listRes.count >= expectMin, `got ${listRes.count}`)
if (expectRows > 0) {
  check('金额是数字类型', typeof listRes.orders[0].amount === 'number')
  check('含 SQL 直接写入的 SO-2001', listRes.orders.some((o) => o.id === 'SO-2001'))
}
console.log('')

// 2. query_user_orders 带过滤
console.log('[2] query_user_orders（按状态过滤 pending）')
const paidRes = await byName.query_user_orders.execute({ status: 'paid' }, exec)
console.log('    count =', paidRes.count, paidRes.orders.map((o) => o.id).join(', '))
check('过滤结果状态一致', paidRes.orders.every((o) => o.status === 'paid'))
console.log('')

// 3. query_order_detail
console.log('[3] query_order_detail（单条）')
const detail = await byName.query_order_detail.execute({ order_id: 'SO-1001' }, exec)
if (expectRows > 0) {
  check('命中 SO-1001', detail.found === true, JSON.stringify(detail))
  console.log('    ->', detail.order?.title, '| ¥' + detail.order?.amount, '|', detail.order?.status)
  const miss = await byName.query_order_detail.execute({ order_id: 'NOT-EXIST' }, exec)
  check('不存在的单号 found=false', miss.found === false)
} else {
  check('隔离会话下查不到 demo 的单', detail.found === false, JSON.stringify(detail))
}
console.log('')

// 4. list_order_statuses
console.log('[4] list_order_statuses（元数据）')
const meta = await byName.list_order_statuses.execute({}, exec)
check('返回 5 种状态', meta.statuses?.length === 5, String(meta.statuses))
console.log('    ' + (meta.statuses ?? []).join(', '))
console.log('')

console.log(fail === 0 ? '========== 工具层全部通过 ==========' : `========== ${fail} 项失败 ==========`)
process.exit(fail === 0 ? 0 : 1)
