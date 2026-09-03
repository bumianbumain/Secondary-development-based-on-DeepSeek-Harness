/**
 * @my-company/system-prompt-hook — 企业第 3 层「核心行为覆盖」样例 Bundle
 *
 * 目标：在不修改 DSH 核心源码、也不替换 deployment persona 的前提下，以
 * Hook 方式把「企业行为覆盖层」注入系统提示词的组装结果，双通道实现：
 *
 *  1. section 注册（声明式）：向 systemPrompt 注入 `enterprise:policy` 段，
 *     落位相对部署 persona 可调：first / before-persona / after-persona /
 *     complete（complete 表示由该段整体接管系统提示词）。
 *  2. assemble 收尾钩子（命令式）：在 system-prompt/assemble waterfall 链尾
 *     await next() 拿到「所有上游改写完成」的权威结果后再决策——企业覆盖段
 *     不在场就放回（guard），保证企业身份与工具优先约束不被上层作用域静默清掉。
 *
 * 为什么是独立槽位而不是另一个 persona：`deployment:persona` 槽已被
 * dsh-system-prompt 服务自身注册占用，同名注册会直接 throw；企业覆盖层因此
 * 用一个专属名字 + 一个收尾钩子，与 persona 解耦、可叠加可插拔、可整体接管。
 *
 * @module @my-company/system-prompt-hook
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'

/** Cordis 插件名。 */
export const name = 'system-prompt-hook'

/** 需要的服务：系统提示词注册表。 */
export const inject = ['systemPrompt']

/** 企业覆盖段的固定名字——收尾钩子靠它识别「自己的段是否在场」。 */
export const ENTERPRISE_POLICY_SECTION = 'enterprise:policy'

/** 覆盖段相对部署 persona 的落位。 */
export type HookPosition = 'first' | 'before-persona' | 'after-persona' | 'complete'

/** 插件配置。 */
export interface Config {
  /**
   * 企业覆盖段主体文本。留空/缺省使用内置默认文案（企业身份 + 多租户隔离 +
   * 数据以工具为准）。文本支持 `{{variable}}`，渲染时由注册表插值。
   */
  text?: string
  /** 覆盖段落位。默认 'after-persona'（紧跟部署 persona 之后）。 */
  position?: HookPosition
  /** 是否在覆盖段后追加「先工具后回答」硬约束。默认 true。 */
  enforceTools?: boolean
  /** 是否启用 assemble 收尾兜底（段被上层改写/删除时放回）。默认 true。 */
  guard?: boolean
  /** 每次组装打印最终 section 清单，便于排查覆盖是否生效。默认 false。 */
  debug?: boolean
}

/** 插件配置 schema（cordis 加载时校验 + 补默认值）。 */
export const Config: z<Config> = z.object({
  text: z.string().default(''),
  position: z.union(['first', 'before-persona', 'after-persona', 'complete'] as const)
    .default('after-persona'),
  enforceTools: z.boolean().default(true),
  guard: z.boolean().default(true),
  debug: z.boolean().default(false),
})

/** 内置默认企业覆盖文案（与 persona 互补：身份与叙事由 persona 讲，规则由覆盖层立）。 */
export const DEFAULT_POLICY_TEXT = [
  '你是企业自研智能体中台的一名业务助手，服务企业内部用户。',
  '多租户隔离：所有业务数据都属于当前会话租户；必须基于工具实际返回的数据作答，',
  '不得假设、不得捏造、不得引用其他租户或会话中不可见的数据。',
  '涉及个人字段（邮箱、电话、地址等）仅在业务确需时使用，输出注意脱敏。',
].join('')

/** 「先工具后回答」硬约束子句。 */
export const TOOL_FIRST_CLAUSE = [
  '强制工具优先：凡是可由已注册业务工具（订单/用户/知识/发票/库存）查到的信息，',
  '必须先调用工具取得真实结果再回答；不得凭印象作答，也不得编造单号、编号或金额。',
].join('')

/**
 * 各落位对应的 section order。
 * 参考注册表 SECTION_ORDERS：harness:identity=-1000、DEPLOYMENT_PERSONA=0、
 * 工具策略段 ≥500，因此 ±1 可把覆盖段钉在 persona 前后，-2000 可钉到最前，
 * complete 走 complete:true 强制语义（渲染时只保留本段）。
 */
const POSITION_ORDER: Record<HookPosition, number> = {
  first: -2000,
  'before-persona': -1,
  'after-persona': 1,
  complete: 0,
}

/** 按配置拼出覆盖段的最终文本（主体 + 可选的工具优先约束）。 */
export function resolvePolicyText(config: Config): string {
  const base = (config.text ?? '').trim() || DEFAULT_POLICY_TEXT
  const enforce = config.enforceTools === false ? '' : `\n\n${TOOL_FIRST_CLAUSE}`
  return `${base}${enforce}`
}

/**
 * 插件入口：注册覆盖段 + 挂 assemble 收尾钩子。
 * @param ctx - Cordis 上下文（须已具备 systemPrompt 服务）。
 * @param config - 企业覆盖配置；缺省全部走默认值。
 */
export function apply(ctx: Context, config: Config = {}): void {
  const text = resolvePolicyText(config)
  const position = config.position ?? 'after-persona'

  // 1) 声明式注入：注册企业覆盖段。ctx.effect 让段随插件生命周期注册与回收。
  ctx.effect(() => ctx.systemPrompt.section({
    name: ENTERPRISE_POLICY_SECTION,
    order: POSITION_ORDER[position],
    text,
    ...(position === 'complete' ? { complete: true } : {}),
  }), 'system-prompt-hook.section()')

  // 2) 命令式收尾钩子：waterfall 链尾兜底 + 可观测。
  //    与 before 语义的前置拦截相反，这里先 await next() 放行所有上游改写，
  //    再检查权威结果；企业段不在场就 push 回去，让覆盖「永远在场」。
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    const assembled = await next()
    if (config.guard !== false
      && !assembled.sections.some(section => section.name === ENTERPRISE_POLICY_SECTION)) {
      assembled.sections.push({ name: ENTERPRISE_POLICY_SECTION, text })
    }
    if (config.debug === true) {
      console.info(
        `[system-prompt-hook] assemble -> sections: `
        + (assembled.sections.map(section => `${section.name}(${section.text.length}ch)`).join(', ') || '(empty)'),
      )
    }
    return assembled
  })
}
