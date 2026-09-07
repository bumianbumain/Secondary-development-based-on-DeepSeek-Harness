/**
 * 登录闸门：按「HubPM 登录页 1440×900」视觉稿还原。
 *
 * 布局
 *   - 左面板 50%：渐变深蓝底（135deg, #24478C → #0D2152）+ 径向高光 +
 *     点阵纹理 + 蓝紫/青绿双径向光晕，三段式（品牌 / 主副文案 / 三栏玻璃特性卡）。
 *   - 右面板 50%：暖白 #FAFAF8 底 + 右上蓝雾 + 左下暖雾，
 *     顶部小品牌标 + 居中 400px 表单列 + 底部页脚。
 *
 * 响应式：≥ 1024px 双栏，< 1024px 隐藏左面板。
 *
 * 安全边界：本组件是体验层遮罩，所有鉴权由服务端 BrowserAuth（HttpOnly Cookie）
 * 把守，未登录请求一律 401；UI 只是让用户看到登录入口。
 *
 * @module @my-company/auth-login/client/LoginGate
 */

import {
  useCallback,
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactElement,
} from 'react'
import { submitLogin } from './session.ts'
import {
  BRAND_BLUE,
  BRAND_BLUE_SHADOW,
  DEFAULT_BRAND,
  DIVIDER,
  FOCUS_RING,
  FONT_STACK,
  ICON_GRAY,
  LEFT_GLOW_BLUE_CENTER,
  LEFT_GLOW_TEAL_CENTER,
  LEFT_GRADIENT_FROM,
  LEFT_GRADIENT_TO,
  RIGHT_TINT_BLUE_CENTER,
  RIGHT_TINT_WARM_CENTER,
  STROKE_DEFAULT,
  STROKE_FOCUS,
  TEXT_FOOTER,
  TEXT_LABEL,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  WARM_CANVAS,
  type BrandContent,
} from './design.ts'

/* ----------------------------- 容器样式 ----------------------------- */

/** 全屏 fixed 容器：把登录层盖在应用外壳之上。 */
const ROOT_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2147483647,
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'stretch',
  fontFamily: FONT_STACK,
  background: WARM_CANVAS,
  color: TEXT_PRIMARY,
}

const LEFT_STYLE: CSSProperties = {
  position: 'relative',
  flex: '0 0 50%',
  overflow: 'hidden',
  background:
    `radial-gradient(120% 120% at 110% -10%, #2F5AA8 0%, rgba(47,90,168,0) 55%), ` +
    `linear-gradient(135deg, ${LEFT_GRADIENT_FROM} 0%, ${LEFT_GRADIENT_TO} 100%)`,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  padding: 64,
  boxSizing: 'border-box',
}

const RIGHT_STYLE: CSSProperties = {
  position: 'relative',
  flex: '1 1 50%',
  background: WARM_CANVAS,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  padding: 64,
  boxSizing: 'border-box',
}

/* ------------------------ 装饰层（光晕 / 柔光） ------------------------ */

const GLOW_BLUE_STYLE: CSSProperties = {
  position: 'absolute',
  top: -160,
  right: -40, // 720 - (240+520) = -40 → 距右边缘 -40
  width: 520,
  height: 520,
  background: `radial-gradient(circle, ${LEFT_GLOW_BLUE_CENTER} 0%, rgba(79, 130, 255, 0) 70%)`,
  pointerEvents: 'none',
}

const GLOW_TEAL_STYLE: CSSProperties = {
  position: 'absolute',
  bottom: -90,
  left: -170,
  width: 470,
  height: 470,
  background: `radial-gradient(circle, ${LEFT_GLOW_TEAL_CENTER} 0%, rgba(46, 194, 186, 0) 70%)`,
  pointerEvents: 'none',
}

const RIGHT_TINT_BLUE_STYLE: CSSProperties = {
  position: 'absolute',
  top: -90,
  right: -110, // 720 - (430+380) = -90 (right panel) → 距右 720-(430+380)=-90 ok
  width: 380,
  height: 380,
  background: `radial-gradient(circle, ${RIGHT_TINT_BLUE_CENTER} 0%, rgba(217, 230, 255, 0) 70%)`,
  pointerEvents: 'none',
}

const RIGHT_TINT_WARM_STYLE: CSSProperties = {
  position: 'absolute',
  bottom: -130,
  left: -130,
  width: 400,
  height: 400,
  background: `radial-gradient(circle, ${RIGHT_TINT_WARM_CENTER} 0%, rgba(255, 240, 214, 0) 70%)`,
  pointerEvents: 'none',
}

/* ------------------------ 左面板内容样式 ------------------------ */

const BRAND_ROW_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
}

const COPY_BLOCK_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  maxWidth: 480,
}

const TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 44,
  lineHeight: 1.36, // 60/44
  fontWeight: 700,
  color: '#FFFFFF',
  letterSpacing: 0,
}

const SUBTITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: 1.73, // 26/15
  color: 'rgba(255, 255, 255, 0.72)',
  maxWidth: 400,
}

const FEATURES_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const FEATURE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '14px 16px',
  borderRadius: 14,
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
}

const FEATURE_ICON_STYLE: CSSProperties = {
  width: 38,
  height: 38,
  flex: '0 0 38px',
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, rgba(108,155,255,0.9), rgba(46,91,224,0.9))',
  boxShadow: '0 6px 14px -4px rgba(46,91,224,0.5)',
}

const FEATURE_TEXT_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const FEATURE_TITLE_STYLE: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#FFFFFF',
}

const FEATURE_DESC_STYLE: CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.55,
  color: 'rgba(255, 255, 255, 0.66)',
}

/* ------------------------ 右面板内容样式 ------------------------ */

const RIGHT_BRAND_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}

const RIGHT_BRAND_NAME_STYLE: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: TEXT_PRIMARY,
  letterSpacing: 0.5,
}

const FORM_AREA_STYLE: CSSProperties = {
  position: 'relative',
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const FORM_COL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 28,
  width: 400,
  maxWidth: '100%',
}

const HEAD_BLOCK_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const FORM_TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 28,
  fontWeight: 700,
  color: TEXT_PRIMARY,
  letterSpacing: 0,
}

const FORM_SUBTITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 14,
  color: TEXT_SECONDARY,
}

const FIELDS_WRAP_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
}

const FIELD_BLOCK_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const LABEL_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: TEXT_LABEL,
}

const INPUT_SHELL_BASE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: 48,
  padding: '0 14px',
  borderRadius: 10,
  background: '#FFFFFF',
  border: `1px solid ${STROKE_DEFAULT}`,
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
  outline: 'none',
}

const INPUT_SHELL_FOCUSED: CSSProperties = {
  borderColor: STROKE_FOCUS,
  borderWidth: 1.5,
  boxShadow: `0 0 0 4px ${FOCUS_RING}`,
}

const INPUT_STYLE: CSSProperties = {
  flex: 1,
  border: 0,
  outline: 'none',
  background: 'transparent',
  fontSize: 14,
  color: TEXT_PRIMARY,
  fontFamily: 'inherit',
  height: '100%',
}

const INPUT_PLACEHOLDER_COLOR = TEXT_MUTED

const OPT_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}

const REMEMBER_GROUP_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
  userSelect: 'none',
}

const REMEMBER_LABEL_STYLE: CSSProperties = {
  fontSize: 13,
  color: TEXT_SECONDARY,
}

const LINK_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: BRAND_BLUE,
  cursor: 'pointer',
  textDecoration: 'none',
  background: 'none',
  border: 0,
  padding: 0,
  fontFamily: 'inherit',
}

const SUBMIT_BTN_STYLE: CSSProperties = {
  position: 'relative',
  height: 48,
  borderRadius: 12,
  background: BRAND_BLUE,
  color: '#FFFFFF',
  border: 0,
  fontSize: 15,
  fontWeight: 500,
  cursor: 'pointer',
  boxShadow: `0 12px 24px -8px ${BRAND_BLUE_SHADOW}`,
  fontFamily: 'inherit',
  overflow: 'hidden',
  transition: 'background 140ms ease, transform 80ms ease',
}

const SUBMIT_BTN_DISABLED: CSSProperties = {
  cursor: 'progress',
}

/** 提交按钮内的 loading spinner（CSS 动画在注入样式里：.dsh-login-spin）。 */
const SPINNER_STYLE: CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: 18,
  height: 18,
  margin: '-9px 0 0 -9px',
  border: '2px solid rgba(255,255,255,0.45)',
  borderTopColor: '#FFFFFF',
  borderRadius: '50%',
}

const BTN_LABEL_STYLE: CSSProperties = {
  display: 'inline-block',
}

const DIVIDER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
}

const DIVIDER_LINE_STYLE: CSSProperties = {
  flex: 1,
  height: 1,
  background: DIVIDER,
}

const DIVIDER_TEXT_STYLE: CSSProperties = {
  fontSize: 12,
  color: TEXT_MUTED,
}

const SOCIAL_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 40,
}

const SOCIAL_ITEM_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
}

const SOCIAL_BTN_STYLE: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 12,
  background: '#FFFFFF',
  border: `1px solid ${STROKE_DEFAULT}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
}

const SOCIAL_LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  color: TEXT_SECONDARY,
}

const REG_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontSize: 13,
  color: TEXT_SECONDARY,
}

const REG_LINK_STYLE: CSSProperties = {
  ...LINK_STYLE,
  fontWeight: 600,
}

const FOOTER_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
}

const FOOTER_TEXT_STYLE: CSSProperties = {
  fontSize: 12,
  color: TEXT_MUTED,
  margin: 0,
  textAlign: 'center',
}

const FOOTER_COPY_STYLE: CSSProperties = {
  ...FOOTER_TEXT_STYLE,
  color: TEXT_FOOTER,
}

const ERROR_STYLE: CSSProperties = {
  fontSize: 13,
  color: '#C0392B',
  margin: 0,
}

const TOAST_STYLE: CSSProperties = {
  position: 'fixed',
  bottom: 28,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '8px 14px',
  borderRadius: 8,
  background: 'rgba(29, 33, 41, 0.92)',
  color: '#FFFFFF',
  fontSize: 13,
  zIndex: 2147483647,
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
  pointerEvents: 'none',
}

/* ----------------------------- SVG 图标 ----------------------------- */

const LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none">
  <defs>
    <linearGradient id="lgy" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6C9BFF"/>
      <stop offset="1" stop-color="#2E5BE0"/>
    </linearGradient>
  </defs>
  <rect width="36" height="36" rx="10" fill="url(#lgy)"/>
  <path d="M18 10.5 L24.5 23 H11.5 Z" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/>
  <path d="M9.5 27 C12.5 25.6 15.5 25.6 18 27 C20.5 28.4 23.5 28.4 26.5 27" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" fill="none"/>
</svg>`.trim()

const MAIL_ICON_BLUE = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
  <rect x="1.6" y="3.2" width="14.8" height="11.6" rx="2.6" stroke="${BRAND_BLUE}" stroke-width="1.6"/>
  <path d="M2.8 5.6 L9 10.2 L15.2 5.6" stroke="${BRAND_BLUE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`.trim()

const LOCK_ICON_GRAY = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
  <rect x="3.4" y="7.8" width="11.2" height="8" rx="2.2" stroke="${TEXT_MUTED}" stroke-width="1.6"/>
  <path d="M6 7.8V6.2a3 3 0 0 1 6 0v1.6" stroke="${TEXT_MUTED}" stroke-width="1.6" stroke-linecap="round"/>
</svg>`.trim()

const EYE_OPEN_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
  <path d="M1.9 9C3.1 6 5.8 4.2 9 4.2s5.9 1.8 7.1 4.8c-1.2 3-3.9 4.8-7.1 4.8S3.1 12 1.9 9Z" stroke="${TEXT_MUTED}" stroke-width="1.6" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="2.3" stroke="${TEXT_MUTED}" stroke-width="1.6"/>
</svg>`.trim()

const EYE_OFF_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
  <path d="M2.4 9c1.2-3 3.9-4.8 7.1-4.8 1.6 0 3 .4 4.2 1.1M15.9 9c-1.2 3-3.9 4.8-7.1 4.8-1.5 0-2.9-.4-4-1" stroke="${TEXT_MUTED}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="2.3" stroke="${TEXT_MUTED}" stroke-width="1.6"/>
  <path d="M2 2 L16 16" stroke="${TEXT_MUTED}" stroke-width="1.6" stroke-linecap="round"/>
</svg>`.trim()

const CHECK_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
  <rect width="16" height="16" rx="4" fill="${BRAND_BLUE}"/>
  <path d="M4.2 8.4 L6.8 10.8 L11.8 5.2" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`.trim()

const CHECK_BOX_EMPTY = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
  <rect x="0.5" y="0.5" width="15" height="15" rx="3.5" stroke="${STROKE_DEFAULT}" stroke-width="1"/>
</svg>`.trim()

const WECHAT_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none">
  <path fill-rule="evenodd" d="M7.8 2.8C4.6 2.8 2 5 2 7.75c0 1.55.82 2.93 2.1 3.85l-.6 1.95 2.3-1.1c.62.17 1.28.27 1.96.27.2 0 .4-.01.6-.03-.1-.4-.16-.82-.16-1.24 0-2.83 2.66-5.13 5.94-5.13.2 0 .39.01.58.03C14.1 4.4 11.2 2.8 7.8 2.8Z" fill="${ICON_GRAY}"/>
  <path fill-rule="evenodd" d="M14.72 7.52c-2.94 0-5.32 2-5.32 4.47 0 2.46 2.38 4.46 5.32 4.46.6 0 1.18-.08 1.72-.23l2.16 1.05-.56-1.9c1.24-.83 2-2.03 2-3.38 0-2.47-2.38-4.47-5.32-4.47Z" fill="${ICON_GRAY}"/>
  <circle cx="5.9" cy="6.9" r="0.95" fill="#FFFFFF"/>
  <circle cx="9.9" cy="6.9" r="0.95" fill="#FFFFFF"/>
  <circle cx="12.9" cy="11.9" r="0.85" fill="#FFFFFF"/>
  <circle cx="16.5" cy="11.9" r="0.85" fill="#FFFFFF"/>
</svg>`.trim()

const SMS_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none">
  <path d="M3 6.3A3.3 3.3 0 0 1 6.3 3h9.4A3.3 3.3 0 0 1 19 6.3v5.4a3.3 3.3 0 0 1-3.3 3.3H8.9l-4.4 3v-3.2A3.3 3.3 0 0 1 3 12.3V6.3Z" stroke="${ICON_GRAY}" stroke-width="1.7" stroke-linejoin="round"/>
  <path d="M7 8.3h8M7 11.4h5.4" stroke="${ICON_GRAY}" stroke-width="1.7" stroke-linecap="round"/>
</svg>`.trim()

const FEISHU_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none">
  <path d="M19.6 2.4 2.6 9.3l6.2 2.4 2.4 6.2 8.4-15.5Z" stroke="${ICON_GRAY}" stroke-width="1.7" stroke-linejoin="round"/>
  <path d="M8.8 11.7 19.6 2.4" stroke="${ICON_GRAY}" stroke-width="1.7"/>
</svg>`.trim()

/** 左侧特性卡图标（统一管控 / 全局可见 / AI 辅助）。 */
const FEATURE_ICONS = [
  `
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
  <path d="M10 2.5 17 6.25 10 10 3 6.25 10 2.5Z" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M3 10.25 10 13.75 17 10.25" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M3 14 10 17.5 17 14" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`.trim(),
  `
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
  <path d="M3 17V8M8 17V4M13 17V11M18 17V6" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round"/>
</svg>`.trim(),
  `
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
  <path d="M10 2.5 11.7 7.3 16.5 9 11.7 10.7 10 15.5 8.3 10.7 3.5 9 8.3 7.3 10 2.5Z" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round"/>
</svg>`.trim(),
]

/* ----------------------------- 通用工具 ----------------------------- */

/** 记忆上次用过的「记住我」邮箱（跨标签页 sessionStorage，简单可靠）。 */
const REMEMBER_KEY = 'dsh-auth-login:remember-username'

function loadRememberedUsername(): string {
  try {
    return sessionStorage.getItem(REMEMBER_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveRememberedUsername(value: string): void {
  try {
    if (value) sessionStorage.setItem(REMEMBER_KEY, value)
    else sessionStorage.removeItem(REMEMBER_KEY)
  } catch {
    /* 隐私模式下忽略 */
  }
}

/** 文本字段——把 placeholder 颜色注入 ::placeholder；附加动效关键帧。 */
const PLACEHOLDER_CSS = `
.dsh-login-input::placeholder { color: ${INPUT_PLACEHOLDER_COLOR}; }
.dsh-login-input::-ms-input-placeholder { color: ${INPUT_PLACEHOLDER_COLOR}; }
.dsh-login-spin { animation: dshLoginSpin 0.7s linear infinite; }
@keyframes dshLoginSpin { to { transform: rotate(360deg); } }
.dsh-login-shake { animation: dshLoginShake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97); }
@keyframes dshLoginShake {
  10%, 90% { transform: translateX(-1px); }
  20%, 80% { transform: translateX(2px); }
  30%, 50%, 70% { transform: translateX(-4px); }
  40%, 60% { transform: translateX(4px); }
}
.dsh-login-fadeup { animation: dshLoginFadeUp 0.6s ease both; }
.dsh-login-fadeup-1 { animation-duration: 0.6s; animation-delay: 0.08s; }
.dsh-login-fadeup-2 { animation-duration: 0.6s; animation-delay: 0.16s; }
@keyframes dshLoginFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  .dsh-login-fadeup, .dsh-login-fadeup-1, .dsh-login-fadeup-2, .dsh-login-shake { animation: none; }
}
`

/* ----------------------------- 组件 ----------------------------- */

export interface LoginGateProps {
  /** 覆盖默认品牌文案，便于部署方在 enterprise profile 中换皮。 */
  readonly brand?: BrandContent
}

/** 登录页主体：分屏布局 + 表单 + 装饰层。 */
export function LoginGate({ brand = DEFAULT_BRAND }: LoginGateProps): ReactElement {
  const [username, setUsername] = useState(() => loadRememberedUsername())
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState<boolean>(() => loadRememberedUsername() !== '')
  const [showPwd, setShowPwd] = useState(false)
  const [emailFocused, setEmailFocused] = useState(false)
  const [pwdFocused, setPwdFocused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const userId = useId()
  const emailId = `${userId}-email`
  const pwdId = `${userId}-pwd`

  // 自动清除 toast
  useEffect(() => {
    if (toast === null) return
    const timer = setTimeout(() => setToast(null), 1800)
    return (): void => clearTimeout(timer)
  }, [toast])

  const showToast = useCallback((text: string): void => {
    setToast(text)
  }, [])

  function onRememberChange(next: boolean): void {
    setRemember(next)
    if (!next) saveRememberedUsername('')
    else if (username) saveRememberedUsername(username)
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      await submitLogin(username.trim(), password)
      if (remember) saveRememberedUsername(username.trim())
      // 整页刷新让应用以已认证身份重新启动，避免启动阶段脏请求。
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSubmitting(false)
    }
  }

  function onSocial(method: 'wechat' | 'sms' | 'feishu'): void {
    const map: Record<typeof method, string> = {
      wechat: '微信登录尚未接入',
      sms: '短信登录尚未接入',
      feishu: '飞书登录尚未接入',
    }
    showToast(map[method])
  }

  return (
    <>
      <style>{PLACEHOLDER_CSS}</style>
      <div style={ROOT_STYLE} data-dsh-auth-login>
        {/* ============ 左侧：品牌区 ============ */}
        <aside className="dsh-login-left" style={LEFT_STYLE}>
          <div style={GLOW_BLUE_STYLE} aria-hidden />
          <div style={GLOW_TEAL_STYLE} aria-hidden />
          <DotGridLayer />
          <div className="dsh-login-fadeup" style={BRAND_ROW_STYLE}>
            <span
              aria-hidden
              style={{ width: 36, height: 36, display: 'inline-block' }}
              dangerouslySetInnerHTML={{ __html: LOGO_SVG }}
            />
            <span style={{ fontSize: 20, fontWeight: 700, color: '#FFFFFF' }}>
              {brand.brandName}
            </span>
          </div>
          <div className="dsh-login-fadeup dsh-login-fadeup-1" style={COPY_BLOCK_STYLE}>
            <h1 style={TITLE_STYLE}>{brand.titleLine1}</h1>
            {brand.titleLine2 ? (
              <h1 style={{ ...TITLE_STYLE, marginTop: 0 }}>{brand.titleLine2}</h1>
            ) : null}
            <p style={SUBTITLE_STYLE}>{brand.subtitle}</p>
          </div>
          <div className="dsh-login-fadeup dsh-login-fadeup-2" style={FEATURES_STYLE}>
            {brand.features.map((feature, index) => (
              <div key={feature.title} style={FEATURE_STYLE}>
                <span
                  aria-hidden
                  style={FEATURE_ICON_STYLE}
                  dangerouslySetInnerHTML={{ __html: FEATURE_ICONS[index % FEATURE_ICONS.length] ?? '' }}
                />
                <span style={FEATURE_TEXT_STYLE}>
                  <span style={FEATURE_TITLE_STYLE}>{feature.title}</span>
                  <span style={FEATURE_DESC_STYLE}>{feature.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </aside>

        {/* ============ 右侧：表单区 ============ */}
        <section className="dsh-login-right" style={RIGHT_STYLE}>
          <div style={RIGHT_TINT_BLUE_STYLE} aria-hidden />
          <div style={RIGHT_TINT_WARM_STYLE} aria-hidden />
          <div className="dsh-login-fadeup" style={RIGHT_BRAND_STYLE}>
            <span
              aria-hidden
              style={{ width: 28, height: 28, display: 'inline-block' }}
              dangerouslySetInnerHTML={{ __html: LOGO_SVG }}
            />
            <span style={RIGHT_BRAND_NAME_STYLE}>{brand.brandName}</span>
          </div>
          <div style={FORM_AREA_STYLE}>
            <form className="dsh-login-fadeup dsh-login-fadeup-1" style={FORM_COL_STYLE} onSubmit={onSubmit} noValidate>
              <div style={HEAD_BLOCK_STYLE}>
                <h2 style={FORM_TITLE_STYLE}>{brand.formTitle}</h2>
                <p style={FORM_SUBTITLE_STYLE}>{brand.formSubtitle}</p>
              </div>

              <div style={FIELDS_WRAP_STYLE}>
                {/* 邮箱输入组（聚焦态） */}
                <div style={FIELD_BLOCK_STYLE}>
                  <label style={LABEL_STYLE} htmlFor={emailId}>{brand.emailLabel}</label>
                  <div style={{ ...INPUT_SHELL_BASE, ...(emailFocused ? INPUT_SHELL_FOCUSED : null) }}>
                    <span
                      aria-hidden
                      style={{ width: 18, height: 18, display: 'inline-flex', flex: '0 0 18px' }}
                      dangerouslySetInnerHTML={{ __html: MAIL_ICON_BLUE }}
                    />
                    <input
                      id={emailId}
                      className="dsh-login-input"
                      style={INPUT_STYLE}
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={(event) => {
                        const v = event.target.value
                        setUsername(v)
                        if (remember) saveRememberedUsername(v)
                      }}
                      onFocus={() => setEmailFocused(true)}
                      onBlur={() => setEmailFocused(false)}
                      placeholder={brand.emailPlaceholder}
                      required
                    />
                  </div>
                </div>

                {/* 密码输入组（默认态） */}
                <div style={FIELD_BLOCK_STYLE}>
                  <label style={LABEL_STYLE} htmlFor={pwdId}>{brand.passwordLabel}</label>
                  <div style={{ ...INPUT_SHELL_BASE, ...(pwdFocused ? INPUT_SHELL_FOCUSED : null) }}>
                    <span
                      aria-hidden
                      style={{ width: 18, height: 18, display: 'inline-flex', flex: '0 0 18px' }}
                      dangerouslySetInnerHTML={{ __html: LOCK_ICON_GRAY }}
                    />
                    <input
                      id={pwdId}
                      className="dsh-login-input"
                      style={INPUT_STYLE}
                      type={showPwd ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      onFocus={() => setPwdFocused(true)}
                      onBlur={() => setPwdFocused(false)}
                      placeholder={brand.passwordPlaceholder}
                      required
                    />
                    <button
                      type="button"
                      aria-label={showPwd ? '隐藏密码' : '显示密码'}
                      onClick={() => setShowPwd((s) => !s)}
                      style={{
                        background: 'none',
                        border: 0,
                        padding: 0,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        width: 18,
                        height: 18,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{ width: 18, height: 18, display: 'inline-block' }}
                        dangerouslySetInnerHTML={{ __html: showPwd ? EYE_OFF_ICON : EYE_OPEN_ICON }}
                      />
                    </button>
                  </div>
                </div>

                {/* 辅助选项行 */}
                <div style={OPT_ROW_STYLE}>
                  <label style={REMEMBER_GROUP_STYLE}>
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => onRememberChange(event.target.checked)}
                      style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                    />
                    <span aria-hidden style={{ width: 16, height: 16, display: 'inline-block' }}>
                      {remember ? (
                        <span dangerouslySetInnerHTML={{ __html: CHECK_ICON }} />
                      ) : (
                        <span dangerouslySetInnerHTML={{ __html: CHECK_BOX_EMPTY }} />
                      )}
                    </span>
                    <span style={REMEMBER_LABEL_STYLE}>{brand.rememberMe}</span>
                  </label>
                  <button
                    type="button"
                    style={LINK_STYLE}
                    onClick={() => showToast('请联系管理员重置密码')}
                  >
                    {brand.forgotPassword}
                  </button>
                </div>
              </div>

              {error !== null && (
                <p key={error} className="dsh-login-shake" style={ERROR_STYLE} role="alert">{error}</p>
              )}

              {/* 登录按钮 */}
              <button
                type="submit"
                disabled={submitting}
                style={{
                  ...SUBMIT_BTN_STYLE,
                  ...(submitting ? SUBMIT_BTN_DISABLED : null),
                }}
              >
                <span
                  style={{ ...BTN_LABEL_STYLE, visibility: submitting ? 'hidden' : 'visible' }}
                >
                  {brand.submit}
                </span>
                <span
                  aria-hidden
                  className={submitting ? 'dsh-login-spin' : undefined}
                  style={{ ...SPINNER_STYLE, opacity: submitting ? 1 : 0 }}
                />
              </button>

              {/* 其他登录方式分割线 */}
              <div style={DIVIDER_ROW_STYLE}>
                <span style={DIVIDER_LINE_STYLE} />
                <span style={DIVIDER_TEXT_STYLE}>{brand.socialDivider}</span>
                <span style={DIVIDER_LINE_STYLE} />
              </div>

              {/* 第三方登录 */}
              <div style={SOCIAL_ROW_STYLE}>
                <div style={SOCIAL_ITEM_STYLE}>
                  <button
                    type="button"
                    aria-label={brand.socialWechat}
                    style={SOCIAL_BTN_STYLE}
                    onClick={() => onSocial('wechat')}
                  >
                    <span aria-hidden style={{ width: 22, height: 22, display: 'inline-block' }}
                      dangerouslySetInnerHTML={{ __html: WECHAT_ICON }}
                    />
                  </button>
                  <span style={SOCIAL_LABEL_STYLE}>{brand.socialWechat}</span>
                </div>
                <div style={SOCIAL_ITEM_STYLE}>
                  <button
                    type="button"
                    aria-label={brand.socialSms}
                    style={SOCIAL_BTN_STYLE}
                    onClick={() => onSocial('sms')}
                  >
                    <span aria-hidden style={{ width: 22, height: 22, display: 'inline-block' }}
                      dangerouslySetInnerHTML={{ __html: SMS_ICON }}
                    />
                  </button>
                  <span style={SOCIAL_LABEL_STYLE}>{brand.socialSms}</span>
                </div>
                <div style={SOCIAL_ITEM_STYLE}>
                  <button
                    type="button"
                    aria-label={brand.socialFeishu}
                    style={SOCIAL_BTN_STYLE}
                    onClick={() => onSocial('feishu')}
                  >
                    <span aria-hidden style={{ width: 22, height: 22, display: 'inline-block' }}
                      dangerouslySetInnerHTML={{ __html: FEISHU_ICON }}
                    />
                  </button>
                  <span style={SOCIAL_LABEL_STYLE}>{brand.socialFeishu}</span>
                </div>
              </div>

              {/* 注册引导 */}
              <div style={REG_ROW_STYLE}>
                <span>{brand.registerPrompt}</span>
                <button
                  type="button"
                  style={REG_LINK_STYLE}
                  onClick={() => showToast('尚未开放注册，请联系管理员')}
                >
                  {brand.registerAction}
                </button>
              </div>
            </form>
          </div>

          {/* 底部页脚 */}
          <footer className="dsh-login-fadeup dsh-login-fadeup-2" style={FOOTER_STYLE}>
            <p style={FOOTER_TEXT_STYLE}>{brand.footerLinks}</p>
            <p style={FOOTER_COPY_STYLE}>{brand.footerCopy}</p>
          </footer>
        </section>
      </div>
      {toast !== null && (
        <div role="status" style={TOAST_STYLE}>{toast}</div>
      )}
    </>
  )
}

/**
 * 左面板点阵纹理层：24px 间距、半径 1.3、白色 7% 不透明度。
 * 用 inline SVG dataURL 作为 background-image，避免额外打包样式文件。
 */
function DotGridLayer(): ReactElement {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>
    <circle cx='1.5' cy='1.5' r='1.3' fill='#FFFFFF' fill-opacity='0.07'/>
  </svg>`
  const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundImage: url,
    backgroundRepeat: 'repeat',
    pointerEvents: 'none',
  }
  return <div aria-hidden style={style} />
}
