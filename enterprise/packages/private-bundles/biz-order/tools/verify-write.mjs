/**
 * 写入链路验证：create_order 工具 → OrderDataSource → SQL Server / Mock
 *
 * 用法（默认走 SQL Server，不带环境变量则测 mock 回退）：
 *   ORDER_DATASOURCE=mssql ORDER_DB_MSSQL="..." ORDER_TENANT=demo node tools/verify-write.mjs
 */
import mssql from 'mssql'
import { getOrderDataSource } from '../lib/datasource.js'

const ds = getOrderDataSource()
console.log('数据源实现 =', ds.constructor.name)

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}${extra ? ' -> ' + extra : ''}`) }
  else { fail++; console.log(`FAIL ${name}${extra ? ' -> ' + extra : ''}`) }
}

/** 断言该调用抛出错误 */
async function expectThrow(name, fn, keyword) {
  try {
    await fn()
    check(name, false, '未抛错')
  } catch (e) {
    check(name, !keyword || e.message.includes(keyword), e.message)
  }
}

const TENANT = process.env.ORDER_TENANT || 'demo'
const stamp = Date.now()
const autoId = await ds.createOrder(TENANT, { title: '自动生成单号验证', amount: 1234.56 })
check('创建订单（自动生成单号）', /^SO-\d{8}-[A-Z0-9]{4}$/.test(autoId.id), autoId.id)
check('默认状态为 pending', autoId.status === 'pending', autoId.status)
check('金额写入正确', autoId.amount === 1234.56, String(autoId.amount))
check('租户归属正确', autoId.tenant === TENANT, autoId.tenant)

const fixedId = `TEST-${stamp}`
const fixed = await ds.createOrder(TENANT, { id: fixedId, title: '指定单号验证', amount: 100, status: 'paid' })
check('指定单号创建', fixed.id === fixedId && fixed.status === 'paid', `${fixed.id}/${fixed.status}`)

await expectThrow('重复单号应报错', () => ds.createOrder(TENANT, { id: fixedId, title: '重复', amount: 1 }), '已存在')
await expectThrow('空标题应报错', () => ds.createOrder(TENANT, { title: '   ', amount: 1 }), '标题')
await expectThrow('负金额应报错', () => ds.createOrder(TENANT, { title: '负数', amount: -5 }), '金额')
await expectThrow('NaN 金额应报错', () => ds.createOrder(TENANT, { title: 'NaN', amount: Number('abc') }), '金额')
await expectThrow('非法状态应报错', () => ds.createOrder(TENANT, { title: '坏状态', amount: 1, status: 'unknown' }), '状态')

// 写入后能被查到（持久化）
const listed = await ds.listOrders(TENANT, undefined, 100)
check('新订单可被列表查到', listed.some(o => o.id === fixedId), `列表 ${listed.length} 条`)
const got = await ds.getOrder(TENANT, fixedId)
check('新订单可被详情查到', got?.id === fixedId && got.title === '指定单号验证', got?.title ?? 'null')

// 租户隔离：写入 acme 后不应出现在 demo 列表
await ds.createOrder('acme', { id: `TEST-ACME-${stamp}`, title: '隔离验证', amount: 9 })
const demoList = await ds.listOrders(TENANT, { keyword: '隔离验证' }, 100)
check('跨租户写入不串数据', demoList.every(o => o.tenant === TENANT), `demo 命中 ${demoList.length} 条`)
const acmeGot = await ds.getOrder('acme', `TEST-ACME-${stamp}`)
check('写入方可读回自己的数据', !!acmeGot, acmeGot?.id ?? 'null')

// 清理测试数据
if (ds.constructor.name === 'SqlServerOrderDataSource') {
  const conn = process.env.ORDER_DB_MSSQL
  const pool = await new mssql.ConnectionPool(conn).connect()
  const r = await pool.request()
    .query(`DELETE FROM dbo.biz_orders WHERE id LIKE 'TEST-%' OR id = N'${autoId.id}'`)
  await pool.close()
  console.log(`\n已清理测试数据 ${r.rowsAffected[0]} 行（保留既有业务数据）`)
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
