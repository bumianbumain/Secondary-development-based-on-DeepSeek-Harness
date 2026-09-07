/**
 * 登录页设计 token —— 直接对照设计稿「HubPM 登录页 1440×900」。
 * 所有色值/圆角/间距均按 HubPM 视觉稿确定。
 *
 * 注：实际渲染时使用响应式布局：视口 ≥ 1024 走分屏；< 1024 隐藏左侧品牌区
 * （保持设计稿的桌面优先气质，移动端简化为单列）。
 *
 * @module @my-company/auth-login/client/design
 */

/** 深蓝主色（左面板渐变起始）。 */
export const LEFT_GRADIENT_FROM = '#24478C'

/** 深蓝末色（左面板渐变结束）。 */
export const LEFT_GRADIENT_TO = '#0D2152'

/** 暖白底色（右面板纯色 + 左面板暖区）。 */
export const WARM_CANVAS = '#FAFAF8'

/** 右面板柔光：右上蓝雾。 */
export const RIGHT_TINT_BLUE_CENTER = 'rgba(217, 230, 255, 0.55)'

/** 右面板柔光：左下暖雾。 */
export const RIGHT_TINT_WARM_CENTER = 'rgba(255, 240, 214, 0.5)'

/** 左侧装饰：蓝紫光晕中心。 */
export const LEFT_GLOW_BLUE_CENTER = 'rgba(79, 130, 255, 0.5)'

/** 左侧装饰：青色光晕中心。 */
export const LEFT_GLOW_TEAL_CENTER = 'rgba(46, 194, 186, 0.35)'

/** 主按钮深蓝、链接色、聚焦描边色。 */
export const BRAND_BLUE = '#2E5BE0'

/** 登录按钮柔蓝阴影。 */
export const BRAND_BLUE_SHADOW = 'rgba(46, 92, 224, 0.32)'

/** 邮箱聚焦态柔光阴影。 */
export const FOCUS_RING = 'rgba(46, 92, 224, 0.16)'

/** 主标题 / 输入文字（深灰偏冷）。 */
export const TEXT_PRIMARY = '#1D2129'

/** 副文本 / 辅助文字。 */
export const TEXT_SECONDARY = '#5C6370'

/** 输入框标签。 */
export const TEXT_LABEL = '#3E4552'

/** 输入框默认描边 / 占位灰 / 分隔线灰。 */
export const TEXT_MUTED = '#9CA3AF'
export const STROKE_DEFAULT = '#E3E3DB'
export const DIVIDER = '#E7E5E0'

/** 页脚 ICP 灰。 */
export const TEXT_FOOTER = '#B4B9C1'

/** 输入框聚焦态描边（与 BRAND_BLUE 同色）。 */
export const STROKE_FOCUS = BRAND_BLUE

/** 社交按钮图标灰（与设计稿 #4B5260 对齐）。 */
export const ICON_GRAY = '#4B5260'

/** 字体栈：Noto Sans SC 在 dsh 内置；回退到 PingFang/Microsoft YaHei 等中文系统字体。 */
export const FONT_STACK =
  '"Noto Sans SC", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif'

/** 左侧特性条目。 */
export interface BrandFeature {
  readonly title: string
  readonly desc: string
}

/**
 * 品牌文案。可由 enterprise profile 在编译期通过产物替换覆盖；
 * 默认保持与设计稿一致（HubPM）以便在没有自定义配置的部署中
 * 也能给出与设计稿视觉对齐的初始体验。
 */
export interface BrandContent {
  readonly brandName: string
  readonly titleLine1: string
  readonly titleLine2: string
  readonly subtitle: string
  readonly features: readonly BrandFeature[]
  readonly formTitle: string
  readonly formSubtitle: string
  readonly emailLabel: string
  readonly emailPlaceholder: string
  readonly passwordLabel: string
  readonly passwordPlaceholder: string
  readonly rememberMe: string
  readonly forgotPassword: string
  readonly submit: string
  readonly submitPending: string
  readonly socialDivider: string
  readonly socialWechat: string
  readonly socialSms: string
  readonly socialFeishu: string
  readonly registerPrompt: string
  readonly registerAction: string
  readonly footerLinks: string
  readonly footerCopy: string
}

export const DEFAULT_BRAND: BrandContent = {
  brandName: 'HubPM',
  titleLine1: '项目管理中心枢纽',
  titleLine2: '',
  subtitle: '连接需求、任务、资源与 AI 辅助，让复杂项目协同变得有序、透明、可控。',
  features: [
    { title: '统一管控', desc: '需求、任务、文档、人员集中管理，告别多系统切换。' },
    { title: '全局可见', desc: '实时进度与风险看板，项目状态一目了然。' },
    { title: 'AI 辅助', desc: '内置 Agent 自动推进重复工作，释放团队精力。' },
  ],
  formTitle: '欢迎回来',
  formSubtitle: '登录 HubPM，继续推进你的工作',
  emailLabel: '用户名',
  emailPlaceholder: '请输入用户名',
  passwordLabel: '密码',
  passwordPlaceholder: '请输入密码',
  rememberMe: '记住我',
  forgotPassword: '忘记密码？',
  submit: '登 录',
  submitPending: '登录中…',
  socialDivider: '其他登录方式',
  socialWechat: '微信',
  socialSms: '短信登录',
  socialFeishu: '飞书',
  registerPrompt: '还没有账户？',
  registerAction: '立即注册',
  footerLinks: '服务协议 · 隐私政策 · 帮助中心',
  footerCopy: '© 2026 云屿科技 · 京ICP备2026138420号-1',
}
