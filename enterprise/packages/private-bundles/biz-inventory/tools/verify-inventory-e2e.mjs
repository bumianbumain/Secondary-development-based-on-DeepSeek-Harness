/**
 * biz-inventory → SQL Server 端到端验证脚本。
 *
 * 覆盖：建表种子、status 过滤、warehouse 过滤、keyword 搜索（名称/SKU/ID）、组合过滤、
 * limit 截断、租户隔离、跨租户越权取库存返回 null、getItem 按 SKU 与按 ID 双路径、
 * 数量为数字、listWarehouses 去重、SQL 注入防护。
 *
 * 幂等设计：只读断言基于 demo 种子（固定 4 条），不写库、不产生测试租户残留。
 * 用法：INVENTORY_DATASOURCE=mssql INVENTORY_DB_MSSQL="<连接串>" node tools/verify-inventory-e2e.mjs
 */

import { getInventoryDataSource } from '../lib/datasource.js'

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}  ${detail ?? ''}`) }
}

const ds = getInventoryDataSource()
console.log('datasource type =', ds.constructor.name)

// —— 建表 + 种子 ——
const all = await ds.listItems('demo')
check('建表+种子：demo 返回 4 条库存', all.length === 4, `got ${all.length}`)

// —— 中文与数量类型 ——
const cam = all.find(i => i.id === 'INV-1001')
check('中文名称正常：INV-1001 智能摄像头 Pro', cam?.name === '智能摄像头 Pro', JSON.stringify(cam?.name))
check('数量是 number 且 = 120 / reserved=10', typeof cam?.quantity === 'number' && cam.quantity === 120 && cam.reserved === 10, `q=${cam?.quantity} type=${typeof cam?.quantity}`)
check('状态往返：INV-1001 status=in_stock', cam?.status === 'in_stock', JSON.stringify(cam?.status))

// —— status 过滤 ——
const low = await ds.listItems('demo', { status: 'low_stock' })
check('status=low_stock 过滤命中 INV-1002', low.length === 1 && low[0].id === 'INV-1002', JSON.stringify(low.map(i => i.id)))
const outs = await ds.listItems('demo', { status: 'out_of_stock' })
check('status=out_of_stock 过滤命中 INV-1003', outs.length === 1 && outs[0].id === 'INV-1003', JSON.stringify(outs.map(i => i.id)))
const resv = await ds.listItems('demo', { status: 'reserved' })
check('status=reserved 过滤命中 INV-1004', resv.length === 1 && resv[0].id === 'INV-1004', JSON.stringify(resv.map(i => i.id)))

// —— warehouse 过滤（中文仓库名）——
const sh = await ds.listItems('demo', { warehouse: '上海仓' })
check('warehouse=上海仓 命中 2 条', sh.length === 2 && sh.every(i => i.warehouse === '上海仓'), JSON.stringify(sh.map(i => i.id)))

// —— keyword 搜索（名称/SKU/ID 任一命中）——
const kwName = await ds.listItems('demo', { keyword: '服务器' })
check('keyword=服务器 命中 AI 训练服务器', kwName.length === 1 && kwName[0].id === 'INV-1004', JSON.stringify(kwName.map(i => i.id)))
const kwSku = await ds.listItems('demo', { keyword: 'SKU-B001' })
check('keyword=SKU-B001 命中工业传感器套件', kwSku.length === 1 && kwSku[0].id === 'INV-1003', JSON.stringify(kwSku.map(i => i.id)))
const kwId = await ds.listItems('demo', { keyword: 'INV-1002' })
check('keyword=INV-1002 命中边缘计算网关', kwId.length === 1 && kwId[0].id === 'INV-1002', JSON.stringify(kwId.map(i => i.id)))

// —— status + warehouse 组合 ——
const combo = await ds.listItems('demo', { status: 'in_stock', warehouse: '上海仓' })
check('status=in_stock+warehouse=上海仓 组合命中', combo.length === 1 && combo[0].id === 'INV-1001')
const comboMiss = await ds.listItems('demo', { status: 'out_of_stock', warehouse: '上海仓' })
check('status=out_of_stock+warehouse=上海仓 组合无命中', comboMiss.length === 0)

// —— limit 截断 ——
const lim = await ds.listItems('demo', undefined, 2)
check('limit=2 截断', lim.length === 2, `got ${lim.length}`)

// —— 租户隔离 ——
const acme = await ds.listItems('acme')
check('租户隔离：acme 为空（未 seed）', acme.length === 0, `got ${acme.length}`)

// —— getItem 双路径：按 SKU 与按 ID ——
const bySku = await ds.getItem('demo', 'SKU-A001')
check('getItem 按 SKU 命中（SKU-A001 → INV-1001）', !!bySku && bySku.id === 'INV-1001', JSON.stringify(bySku?.id))
const byId = await ds.getItem('demo', 'INV-1003')
check('getItem 按 ID 命中（INV-1003 → SKU-B001）', !!byId && byId.sku === 'SKU-B001', JSON.stringify(byId?.sku))
const miss = await ds.getItem('demo', 'SKU-XXXX')
check('getItem 未命中返回 null', miss === null)
const cross = await ds.getItem('acme', 'SKU-A001')
check('跨租户越权取库存返回 null（隔离成立）', cross === null)

// —— listWarehouses 去重 ——
const whs = await ds.listWarehouses('demo')
check('listWarehouses 去重返回 3 个仓库', whs.length === 3 && whs.includes('上海仓') && whs.includes('北京仓') && whs.includes('深圳仓'), JSON.stringify(whs))
const whsAcme = await ds.listWarehouses('acme')
check('listWarehouses 租户隔离：acme 返回空', whsAcme.length === 0)

// —— 状态枚举 ——
const statuses = ds.listStatuses()
check('listStatuses 返回 4 个状态', statuses.length === 4 && statuses.includes('in_stock') && statuses.includes('out_of_stock'), JSON.stringify(statuses))

// —— SQL 注入防护 ——
const inj = await ds.listItems('demo', { keyword: "'; DROP TABLE dbo.biz_inventory;--" })
check('SQL 注入串被当普通文本（返回空不炸库）', Array.isArray(inj) && inj.length === 0, JSON.stringify(inj).slice(0, 80))
const injDet = await ds.getItem('demo', "'; DROP TABLE dbo.biz_inventory;--")
check('getItem 注入串返回 null（不炸库）', injDet === null)
const still = await ds.listItems('demo')
check('注入后表仍完好（demo 仍有 4 条）', still.length === 4, `got ${still.length}`)

console.log(`\n结果：${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
