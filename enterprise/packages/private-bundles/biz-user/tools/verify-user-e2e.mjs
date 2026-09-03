/**
 * biz-user → SQL Server 数据源层端到端验证。
 * 走 getUserDataSource() 工厂（web/工具层用的同一个入口）。
 * 覆盖：建连建表、种子、租户隔离、跨租户越权取用户、role/keyword 组合过滤、
 *      limit 截断、SQL 注入防护、roles 数组往返。
 *
 * 运行：USER_DATASOURCE=mssql USER_DB_MSSQL="<连接串>" node tools/verify-user-e2e.mjs
 */
import { getUserDataSource } from '../lib/datasource.js'

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}  ${extra}`) }
}

const ds = getUserDataSource()
console.log(`datasource type = ${ds.constructor.name}\n`)

const demo = await ds.listUsers('demo')
check('建表+种子：demo 租户返回 4 个种子用户', demo.length === 4, `got ${demo.length}`)

const u2 = demo.find(u => u.id === 'U-002')
check('roles 数组往返：U-002 roles=[operator,finance]', !!u2 && u2.roles.includes('operator') && u2.roles.includes('finance'), JSON.stringify(u2?.roles))
check('中文姓名正常：U-001 name=张伟', demo.find(u => u.id === 'U-001')?.name === '张伟', demo.find(u => u.id === 'U-001')?.name)

// 租户隔离：acme 租户（未 seed）应返回空，且看不到 demo 的用户
const acmeAll = await ds.listUsers('acme')
check('租户隔离：acme 租户为空列表（未 seed）', acmeAll.length === 0, `got ${acmeAll.length}`)

// 跨租户越权取用户：demo 的 U-001 在 acme 名下查应返回 null
const cross = await ds.getUser('acme', 'U-001')
check('跨租户越权取用户返回 null（隔离成立）', cross === null, JSON.stringify(cross))

// 合法取用户：demo 名下能查到 U-001
const mine = await ds.getUser('demo', 'U-001')
check('本租户取用户 U-001 命中', !!mine && mine.id === 'U-001', JSON.stringify(mine))
check('本租户取用户 U-999 未命中返回 null', (await ds.getUser('demo', 'U-999')) === null)

// role 过滤
const admin = await ds.listUsers('demo', { role: 'admin' })
check('role=admin 过滤：只含 admin', admin.length >= 1 && admin.every(u => u.roles.includes('admin')), `got ${admin.length}`)
// role 匹配含多角色成员（U-002 同时是 operator+finance）
const finance = await ds.listUsers('demo', { role: 'finance' })
check('role=finance 过滤：命中多角色成员 U-002', finance.some(u => u.id === 'U-002'), JSON.stringify(finance.map(u => u.id)))

// keyword 过滤
const kwName = await ds.listUsers('demo', { keyword: '张伟' })
check('keyword=张伟 命中 U-001', kwName.length === 1 && kwName[0].id === 'U-001', JSON.stringify(kwName.map(u => u.id)))
const kwEmail = await ds.listUsers('demo', { keyword: 'demo.com' })
check('keyword=demo.com 命中全部 demo 用户', kwEmail.length === 4, `got ${kwEmail.length}`)
const kwId = await ds.listUsers('demo', { keyword: 'U-003' })
check('keyword=U-003 命中 U-003', kwId.length === 1 && kwId[0].id === 'U-003', JSON.stringify(kwId.map(u => u.id)))

// role + keyword 组合
const combo = await ds.listUsers('demo', { role: 'operator', keyword: 'demo' })
check('role=operator+keyword=demo 组合过滤', combo.length >= 1 && combo.every(u => u.roles.includes('operator')), JSON.stringify(combo.map(u => u.id)))

// limit 截断
const lim = await ds.listUsers('demo', undefined, 2)
check('limit=2 截断', lim.length === 2, `got ${lim.length}`)
const allNoLimit = await ds.listUsers('demo')
check('默认 limit=10 返回全部 4 条', allNoLimit.length === 4, `got ${allNoLimit.length}`)

// SQL 注入防护：塞注入串应被当普通文本，不报错且不返回越权/不删表
const inj = await ds.listUsers('demo', { keyword: "'; DROP TABLE dbo.biz_users;--" })
check('SQL 注入串被当普通文本（返回空不炸库）', Array.isArray(inj) && inj.length === 0, JSON.stringify(inj).slice(0, 80))
const stillThere = await ds.listUsers('demo')
check('注入后表仍完好（demo 仍有 4 用户）', stillThere.length === 4, `got ${stillThere.length}`)

// 角色枚举
const roles = ds.listRoles()
check('listRoles 返回 4 个角色', roles.length === 4 && roles.includes('admin') && roles.includes('finance'), JSON.stringify(roles))

console.log('\n—— createUser 写入链路（用独立随机测试租户，不污染 demo 种子，可重复运行）——')

// 随机租户名确保脚本幂等（重复跑不撞既有主键）
const T = `vt${Date.now().toString(36)}`
const created = await ds.createUser(T, { name: '陈晨', email: 'chenchen@verify.com', roles: ['operator'] })
// id 主键全局唯一：demo 已占 U-001~004，故自动编号应 ≥ U-005（绝不复用 demo 已占的编号）
check('createUser 落库并自动生成全局唯一 U- 编号', /^U-0\d+$/.test(created.id) && created.id >= 'U-005', JSON.stringify(created))
check('createUser 数据正确 name=陈晨/status=active', created.name === '陈晨' && created.status === 'active', JSON.stringify(created))
check('createUser 角色生效 roles=[operator]', created.roles.length === 1 && created.roles[0] === 'operator', JSON.stringify(created.roles))

// 指定 ID + 默认值（显式 ID 用随机值，保证全局主键不撞、脚本可重复跑）
const EXID = `VX-${Date.now().toString(36).toUpperCase()}`
const created2 = await ds.createUser(T, { id: EXID, name: '测试用户', email: 'test@verify.com' })
check('createUser 支持指定 ID 与默认 roles/status', created2.id === EXID && created2.roles[0] === 'viewer' && created2.status === 'active', JSON.stringify(created2))

// 持久化：用 getUser 复核写入确实在库里
const back = await ds.getUser(T, created.id)
check('写入持久化：getUser 能查回新建用户', !!back && back.name === '陈晨', JSON.stringify(back))

// 租户隔离：写入随机租户不影响 demo；demo 仍查不到该随机租户新建的用户
const demoAfter = await ds.listUsers('demo')
check('写入隔离：demo 仍 4 条（不受随机测试租户影响）', demoAfter.length === 4, `got ${demoAfter.length}`)
const crossWrite = await ds.getUser('demo', created.id)
check('跨租户隔离：demo 查随机租户的新用户返回 null', crossWrite === null, JSON.stringify(crossWrite))

// 非法输入防护
let nameErr = false; try { await ds.createUser(T, { name: '', email: 'a@b.com' }) } catch { nameErr = true }
check('空姓名被拒绝', nameErr)
let emailErr = false; try { await ds.createUser(T, { name: 'x', email: 'not-an-email' }) } catch { emailErr = true }
check('非法邮箱被拒绝', emailErr)
let roleErr = false; try { await ds.createUser(T, { name: 'x', email: 'x@y.com', roles: ['superadmin'] }) } catch { roleErr = true }
check('非法角色被拒绝', roleErr)
let statusErr = false; try { await ds.createUser(T, { name: 'x', email: 'x@y.com', status: 'frozen' }) } catch { statusErr = true }
check('非法状态被拒绝', statusErr)

// 主键冲突（用上面同一个显式 ID 再建一次，应报友好错误）
let dupErr = false; try { await ds.createUser(T, { id: EXID, name: '重复', email: 'dup@verify.com' }) } catch (e) { dupErr = /已存在/.test(e.message) }
check('重复 ID 报友好错误（主键冲突捕获）', dupErr)

// SQL 注入防护：姓名/邮箱塞注入串应被当普通文本或拒绝，不炸库
try { await ds.createUser(T, { name: "'; DROP TABLE dbo.biz_users;--", email: 'inj@verify.com' }) } catch {}
const afterInj = await ds.listUsers('demo')
check('createUser 注入串不炸库（demo 仍 4 条）', afterInj.length === 4, `got ${afterInj.length}`)

console.log(`\n结果：${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
