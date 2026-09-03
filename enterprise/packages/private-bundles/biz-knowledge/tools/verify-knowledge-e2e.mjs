/**
 * biz-knowledge → SQL Server 端到端验证脚本。
 *
 * 覆盖：建表种子、category 过滤、tag 过滤、keyword 搜索、limit 截断、租户隔离、
 * 跨租户越权取文档返回 null、tags 数组往返、中文正常、listTags 去重、SQL 注入防护。
 *
 * 幂等设计：只读断言基于 demo 种子（固定 4 篇），不写库、不产生测试租户残留。
 * 用法：USER_DATASOURCE=mssql USER_DB_MSSQL="<连接串>" node tools/verify-knowledge-e2e.mjs
 */

import { getKnowledgeDataSource } from '../lib/datasource.js'

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}  ${detail ?? ''}`) }
}

const ds = getKnowledgeDataSource()
console.log('datasource type =', ds.constructor.name)

// —— 建表 + 种子 ——
const all = await ds.searchDocs('demo')
check('建表+种子：demo 返回 4 篇文档', all.length === 4, `got ${all.length}`)

// —— 中文与 tags 数组往返 ——
const kb1 = all.find(d => d.id === 'KB-1001')
check('中文标题正常：KB-1001 如何重置账号密码', kb1?.title === '如何重置账号密码', JSON.stringify(kb1?.title))
check('tags 数组往返：KB-1001 含 账号/密码/自助', !!kb1 && kb1.tags.length === 3 && kb1.tags.includes('账号') && kb1.tags.includes('IoT') === false, JSON.stringify(kb1?.tags))
const kb4 = all.find(d => d.id === 'KB-1004')
check('IoT 标签往返：KB-1004 tags=[摄像头,离线,IoT]', !!kb4 && kb4.tags.includes('IoT'), JSON.stringify(kb4?.tags))

// —— category 过滤 ——
const faq = await ds.searchDocs('demo', { category: 'faq' })
check('category=faq 过滤命中 KB-1001', faq.length === 1 && faq[0].id === 'KB-1001', JSON.stringify(faq.map(d => d.id)))
const sop = await ds.searchDocs('demo', { category: 'sop' })
check('category=sop 过滤命中 KB-1002', sop.length === 1 && sop[0].id === 'KB-1002', JSON.stringify(sop.map(d => d.id)))

// —— tag 过滤（tags 存逗号分隔串，子串匹配）——
const tagOrder = await ds.searchDocs('demo', { tag: '订单' })
check('tag=订单 命中 KB-1002', tagOrder.length === 1 && tagOrder[0].id === 'KB-1002', JSON.stringify(tagOrder.map(d => d.id)))
const tagOps = await ds.searchDocs('demo', { tag: '运营' })
check('tag=运营 命中 KB-1002（多标签之一）', tagOps.some(d => d.id === 'KB-1002'))

// —— keyword 搜索（标题/内容/tags 任一命中）——
const kwTitle = await ds.searchDocs('demo', { keyword: '发货' })
check('keyword=发货 命中 KB-1002 标题', kwTitle.length === 1 && kwTitle[0].id === 'KB-1002', JSON.stringify(kwTitle.map(d => d.id)))
const kwContent = await ds.searchDocs('demo', { keyword: '固件' })
check('keyword=固件 命中 KB-1004 内容', kwContent.length === 1 && kwContent[0].id === 'KB-1004', JSON.stringify(kwContent.map(d => d.id)))
const kwTag = await ds.searchDocs('demo', { keyword: '密码' })
check('keyword=密码 命中 KB-1001 标签', kwTag.length === 1 && kwTag[0].id === 'KB-1001', JSON.stringify(kwTag.map(d => d.id)))

// —— category + keyword 组合 ——
const combo = await ds.searchDocs('demo', { category: 'sop', keyword: '发货' })
check('category=sop+keyword=发货 组合命中 KB-1002', combo.length === 1 && combo[0].id === 'KB-1002')
const comboMiss = await ds.searchDocs('demo', { category: 'faq', keyword: '发货' })
check('category=faq+keyword=发货 组合无命中', comboMiss.length === 0)

// —— limit 截断 ——
const lim = await ds.searchDocs('demo', undefined, 2)
check('limit=2 截断', lim.length === 2, `got ${lim.length}`)
const allNoLimit = await ds.searchDocs('demo')
check('默认 limit=10 返回全部 4 篇', allNoLimit.length === 4, `got ${allNoLimit.length}`)

// —— 租户隔离 ——
const acme = await ds.searchDocs('acme')
check('租户隔离：acme 为空（未 seed）', acme.length === 0, `got ${acme.length}`)

// —— 单篇详情 ——
const doc1 = await ds.getDoc('demo', 'KB-1001')
check('getDoc 命中 KB-1001', !!doc1 && doc1.title === '如何重置账号密码', JSON.stringify(doc1?.id))
const miss = await ds.getDoc('demo', 'KB-9999')
check('getDoc 未命中返回 null', miss === null)
const cross = await ds.getDoc('acme', 'KB-1001')
check('跨租户越权取文档返回 null（隔离成立）', cross === null)

// —— listTags 去重 ——
const tags = await ds.listTags('demo')
check('listTags 返回去重标签且含 订单/密码/IoT', tags.length >= 9 && tags.includes('订单') && tags.includes('密码') && tags.includes('IoT'), JSON.stringify(tags))
const tagsAcme = await ds.listTags('acme')
check('listTags 租户隔离：acme 返回空', tagsAcme.length === 0, `got ${tagsAcme.length}`)

// —— 分类枚举 ——
const cats = ds.listCategories()
check('listCategories 返回 4 个分类', cats.length === 4 && cats.includes('faq') && cats.includes('troubleshooting'), JSON.stringify(cats))

// —— SQL 注入防护 ——
const inj = await ds.searchDocs('demo', { keyword: "'; DROP TABLE dbo.biz_knowledge;--" })
check('SQL 注入串被当普通文本（返回空不炸库）', Array.isArray(inj) && inj.length === 0, JSON.stringify(inj).slice(0, 80))
const injDoc = await ds.getDoc('demo', "'; DROP TABLE dbo.biz_knowledge;--")
check('getDoc 注入串返回 null（不炸库）', injDoc === null)
const still = await ds.searchDocs('demo')
check('注入后表仍完好（demo 仍有 4 篇）', still.length === 4, `got ${still.length}`)

console.log(`\n结果：${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
