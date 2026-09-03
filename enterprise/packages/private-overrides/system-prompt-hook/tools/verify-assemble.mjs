/**
 * system-prompt-hook — 系统提示词覆盖验证脚本（P3）
 *
 * 不起真实 dsh 服务/LLM，直接按官方 spec 模式装配最小 Cordis 上下文：
 *   new Context() → ctx.plugin(SystemPrompt, cfg) → ctx.plugin(hook, cfg)
 *   → systemPrompt.assemble() → 对 sections 顺序 / renderPrompt 文本断言。
 *
 * 覆盖 8 个场景：默认注入、before-persona、first、complete（整体接管）、
 * guard 兜底（拦截改写）、guard 关闭对照、空 persona 部署、自定义文案。
 *
 * 运行：node tools/verify-assemble.mjs
 */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as hook from '../lib/index.js'

let passed = 0
let failed = 0
function check(cond, message) {
  if (cond) { passed += 1; console.log(`  PASS  ${message}`) }
  else { failed += 1; console.error(`  FAIL  ${message}`) }
}
function sectionNames(assembly) {
  return assembly.sections.map(s => s.name)
}
/** 破坏者插件：把企业覆盖段从组装结果里删掉，验证 guard 是否能兜底放回。 */
const saboteur = {
  name: 'saboteur',
  apply(ctx) {
    ctx.on('system-prompt/assemble', (assembly, _context, next) => {
      assembly.sections = assembly.sections.filter(s => s.name !== hook.ENTERPRISE_POLICY_SECTION)
      return next()
    })
  },
}

console.log('system-prompt-hook 系统提示词覆盖验证')
console.log('--------------------------------------')

// 场景 0：基线对照 —— 没有 hook 时不存在企业覆盖段
{
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: '你是企业 AI 助手。' })
  const names = sectionNames(await ctx.systemPrompt.assemble())
  check(!names.includes(hook.ENTERPRISE_POLICY_SECTION), '场景0 基线：未挂 hook 时无 enterprise:policy 段')
}

// 场景 1：默认注入 —— after-persona，紧跟部署 persona 之后
{
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: '你是企业 AI 助手，负责处理内部业务。' })
  await ctx.plugin(hook, {})
  const assembly = await ctx.systemPrompt.assemble()
  const names = sectionNames(assembly)
  const text = renderPrompt(assembly)
  check(names.includes(hook.ENTERPRISE_POLICY_SECTION), '场景1 默认：企业覆盖段已注入')
  check(names.indexOf('deployment:persona') + 1 === names.indexOf(hook.ENTERPRISE_POLICY_SECTION), '场景1 默认：覆盖段紧跟 persona 之后（order=1）')
  check(text.includes('你是企业 AI 助手，负责处理内部业务。'), '场景1 默认：persona 文本在场')
  check(text.includes('多租户隔离'), '场景1 默认：默认企业策略文案在场')
  check(text.includes('强制工具优先'), '场景1 默认：工具优先硬约束在场')
}

// 场景 2：before-persona —— 覆盖段钉在 persona 之前
{
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: '你是企业 AI 助手。' })
  await ctx.plugin(hook, { position: 'before-persona' })
  const names = sectionNames(await ctx.systemPrompt.assemble())
  check(names.indexOf(hook.ENTERPRISE_POLICY_SECTION) < names.indexOf('deployment:persona'), '场景2 before-persona：覆盖段在 persona 之前')
}

// 场景 3：first —— 覆盖段排到最前（harness identity 之前）
{
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: '你是企业 AI 助手。' })
  await ctx.plugin(hook, { position: 'first' })
  const names = sectionNames(await ctx.systemPrompt.assemble())
  check(names[0] === hook.ENTERPRISE_POLICY_SECTION, '场景3 first：覆盖段为 sections[0]')
}

// 场景 4：complete —— 整体接管系统提示词（白标场景，连 harness identity 都不保留）
{
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: 'You are DeepSeek Harness.' })
  await ctx.plugin(hook, { position: 'complete' })
  const assembly = await ctx.systemPrompt.assemble()
  const names = sectionNames(assembly)
  const text = renderPrompt(assembly)
  check(names.length === 1 && names[0] === hook.ENTERPRISE_POLICY_SECTION, '场景4 complete：仅保留企业覆盖段')
  check(!text.includes('DeepSeek Harness'), '场景4 complete：harness identity 已被企业文本整体接管')
  check(text.includes('强制工具优先'), '场景4 complete：渲染文本为完整企业覆盖')
}

// 场景 5：guard 兜底 —— 上游把覆盖段删掉，收尾钩子放回（拦截改写）
{
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: '你是企业 AI 助手。' })
  await ctx.plugin(hook, {})
  await ctx.plugin(saboteur, {})
  const assembly = await ctx.systemPrompt.assemble()
  const names = sectionNames(assembly)
  check(names.includes(hook.ENTERPRISE_POLICY_SECTION), '场景5 guard：上游删除后企业覆盖段被钩子兜底放回')
  const count = names.filter(n => n === hook.ENTERPRISE_POLICY_SECTION).length
  check(count === 1, `场景5 guard：无重复注入（实际 ${count} 次）`)
}

// 场景 6：guard 关闭对照 —— guard:false 时删除即删除
{
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: '你是企业 AI 助手。' })
  await ctx.plugin(hook, { guard: false })
  await ctx.plugin(saboteur, {})
  const names = sectionNames(await ctx.systemPrompt.assemble())
  check(!names.includes(hook.ENTERPRISE_POLICY_SECTION), '场景6 guard:false：关闭兜底后删除生效（对照）')
}

// 场景 7：空 persona 部署 —— 企业覆盖不依赖 persona 配置，仍然在场
{
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {}) // persona 留空
  await ctx.plugin(hook, {})
  const text = renderPrompt(await ctx.systemPrompt.assemble())
  check(text.includes('多租户隔离') && text.includes('强制工具优先'), '场景7 空 persona：企业覆盖文案仍注入（不依赖 persona 配置）')
}

// 场景 8：自定义文案 + 关闭工具强制 + debug 打印
{
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: '你是企业 AI 助手。' })
  await ctx.plugin(hook, { text: '本企业强制要求：答复必须使用简体中文。', enforceTools: false, debug: true })
  const text = renderPrompt(await ctx.systemPrompt.assemble())
  check(text.includes('本企业强制要求：答复必须使用简体中文。'), '场景8 自定义文案：部署方覆盖文案生效')
  check(!text.includes('强制工具优先'), '场景8 自定义文案：enforceTools:false 未追加工具约束')
}

console.log('--------------------------------------')
console.log(`结果：${passed}/${passed + failed} 断言通过`)
if (failed > 0) process.exitCode = 1
