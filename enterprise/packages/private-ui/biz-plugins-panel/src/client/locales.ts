/** Copy dictionaries for the enterprise business-plugins Settings tab. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: '企业业务插件',
  intro: '本页仅展示企业私有业务插件（@my-company/*）：在不改动 DSH 核心源码的前提下，通过 Bundle 叠加挂载到智能体平台。',
  loading: '正在读取插件…',
  error: '暂时无法读取插件清单。',
  retry: '重试',
  search: '搜索业务插件',
  emptySearch: '没有匹配的业务插件。',
  failedTag: '启动失败',
  enabledTag: '已启用',
  disabledTag: '已停用',
  moduleLabel: '完整包名',
  entryLabel: 'Loader 条目',
  configLabel: '配置状态',
  runtimeLabel: '运行状态',
  domainLabel: '业务域',
  toolsLabel: '注册工具',
  unobserved: '未运行',
} satisfies Record<string, string>

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'Enterprise business plugins',
  intro: 'This tab lists only the private enterprise business plugins (@my-company/*): mounted onto the agent platform via Bundle layering, without touching DSH core source.',
  loading: 'Reading plugins…',
  error: 'Plugin manifest is temporarily unavailable.',
  retry: 'Retry',
  search: 'Search business plugins',
  emptySearch: 'No matching business plugins.',
  failedTag: 'Failed',
  enabledTag: 'Enabled',
  disabledTag: 'Disabled',
  moduleLabel: 'Package name',
  entryLabel: 'Loader entry',
  configLabel: 'Configuration',
  runtimeLabel: 'Runtime',
  domainLabel: 'Domain',
  toolsLabel: 'Registered tools',
  unobserved: 'Not running',
} satisfies Record<string, string>

/** Locale key union. */
export type BizPluginsLocaleKey = keyof typeof zh
