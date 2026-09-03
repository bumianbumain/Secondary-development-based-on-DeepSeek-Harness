/**
 * biz-invoice → SQL Server 端到端验证脚本。
 *
 * 覆盖：建表种子、status 过滤、orderId 过滤、keyword 搜索、组合过滤、limit 截断、
 * 租户隔离、跨租户越权取发票返回 null、金额/税率数字类型正确、SQL 注入防护。
 *
 * 幂等设计：只读断言基于 demo 种子（固定 4 张），不写库、不产生测试租户残留。
 * 用法：INVOICE_DATASOURCE=mssql INVOICE_DB_MSSQL="<连接串>" node tools/verify-invoice-e2e.mjs
 */

import { getInvoiceDataSource } from '../lib/datasource.js'

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}  ${detail ?? ''}`) }
}

const ds = getInvoiceDataSource()
console.log('datasource type =', ds.constructor.name)

// —— 建表 + 种子 ——
const all = await ds.listInvoices('demo')
check('建表+种子：demo 返回 4 张发票', all.length === 4, `got ${all.length}`)

// —— 金额/税率为数字类型（decimal 驱动可能返回 string，须 Number 兜底）——
const inv1 = all.find(i => i.id === 'INV-2026-0001')
check('发票号正确：INV-2026-0001 关联 SO-1001', inv1?.id === 'INV-2026-0001' && inv1.orderId === 'SO-1001', JSON.stringify(inv1?.id))
check('金额是 number 且 = 12000', typeof inv1?.amount === 'number' && inv1.amount === 12000, `type=${typeof inv1?.amount} val=${inv1?.amount}`)
check('税率是 number 且 = 0.06', typeof inv1?.taxRate === 'number' && inv1.taxRate === 0.06, `type=${typeof inv1?.taxRate} val=${inv1?.taxRate}`)
check('发票状态往返：INV-2026-0001 status=paid', inv1?.status === 'paid', JSON.stringify(inv1?.status))

// —— status 过滤 ——
const paid = await ds.listInvoices('demo', { status: 'paid' })
check('status=paid 过滤命中 INV-2026-0001', paid.length === 1 && paid[0].id === 'INV-2026-0001', JSON.stringify(paid.map(i => i.id)))
const overdue = await ds.listInvoices('demo', { status: 'overdue' })
check('status=overdue 过滤命中 INV-2026-0004', overdue.length === 1 && overdue[0].id === 'INV-2026-0004', JSON.stringify(overdue.map(i => i.id)))
const none = await ds.listInvoices('demo', { status: 'cancelled' })
check('status=cancelled 无命中（种子无该状态）', none.length === 0)

// —— orderId 过滤（跨 Bundle 关联：查 SO-1002 的发票）——
const so1002 = await ds.listInvoices('demo', { orderId: 'SO-1002' })
check('orderId=SO-1002 过滤命中 INV-2026-0002', so1002.length === 1 && so1002[0].id === 'INV-2026-0002', JSON.stringify(so1002.map(i => i.id)))

// —— keyword 搜索（发票号/订单号任一命中）——
const kwId = await ds.listInvoices('demo', { keyword: '0003' })
check('keyword=0003 命中 INV-2026-0003', kwId.length === 1 && kwId[0].id === 'INV-2026-0003', JSON.stringify(kwId.map(i => i.id)))
const kwOrder = await ds.listInvoices('demo', { keyword: 'SO-1004' })
check('keyword=SO-1004 命中 INV-2026-0004', kwOrder.length === 1 && kwOrder[0].id === 'INV-2026-0004', JSON.stringify(kwOrder.map(i => i.id)))

// —— status + orderId 组合 ——
const combo = await ds.listInvoices('demo', { status: 'sent', orderId: 'SO-1002' })
check('status=sent+orderId=SO-1002 组合命中', combo.length === 1 && combo[0].id === 'INV-2026-0002')
const comboMiss = await ds.listInvoices('demo', { status: 'paid', orderId: 'SO-1002' })
check('status=paid+orderId=SO-1002 组合无命中', comboMiss.length === 0)

// —— limit 截断 ——
const lim = await ds.listInvoices('demo', undefined, 2)
check('limit=2 截断', lim.length === 2, `got ${lim.length}`)

// —— 租户隔离 ——
const acme = await ds.listInvoices('acme')
check('租户隔离：acme 为空（未 seed）', acme.length === 0, `got ${acme.length}`)

// —— 单张详情 ——
const det = await ds.getInvoice('demo', 'INV-2026-0002')
check('getInvoice 命中 INV-2026-0002', !!det && det.orderId === 'SO-1002' && det.amount === 8000, JSON.stringify(det?.id))
const miss = await ds.getInvoice('demo', 'INV-2026-9999')
check('getInvoice 未命中返回 null', miss === null)
const cross = await ds.getInvoice('acme', 'INV-2026-0001')
check('跨租户越权取发票返回 null（隔离成立）', cross === null)

// —— 状态枚举 ——
const statuses = ds.listStatuses()
check('listStatuses 返回 5 个状态', statuses.length === 5 && statuses.includes('issued') && statuses.includes('overdue'), JSON.stringify(statuses))

// —— SQL 注入防护 ——
const inj = await ds.listInvoices('demo', { keyword: "'; DROP TABLE dbo.biz_invoices;--" })
check('SQL 注入串被当普通文本（返回空不炸库）', Array.isArray(inj) && inj.length === 0, JSON.stringify(inj).slice(0, 80))
const injDet = await ds.getInvoice('demo', "'; DROP TABLE dbo.biz_invoices;--")
check('getInvoice 注入串返回 null（不炸库）', injDet === null)
const still = await ds.listInvoices('demo')
check('注入后表仍完好（demo 仍有 4 张）', still.length === 4, `got ${still.length}`)

console.log(`\n结果：${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
