/**
 * auth-login 浏览器半入口——登录闸门。
 *
 * 运行时机：client 模块系统在应用挂载前激活所有插件 apply（见
 * packages/client/web/src/boot.ts：loader.await() 之后才 uiRenderer.mount(#root)），
 * 因此本闸门从「应用尚未挂载」的瞬间就开始工作：
 *
 *   1. apply() 同步铺一个品牌启动层（splash）盖住整个视口，杜绝未登录状态下
 *      应用外壳/内容的闪现（应用随后挂载在 splash 之下，用户不可见）。
 *   2. 探活 GET /api/session/me：
 *        · 已认证（含 ?token 启动令牌铸造的旧会话）→ 移除 splash，正常使用；
 *        · 未认证（401）→ 换成登录页（POST /login 成功后整页刷新）。
 *
 * 安全边界说明：本闸门只是体验层。真正的鉴权闸门在服务端——
 * BrowserAuth 对 /api/* 一律 isAuthenticated() 校验 HttpOnly Cookie，
 * 未登录请求拿到 401，登录页 UI 遮不住任何越权。
 *
 * @module @my-company/auth-login/client
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { LoginGate } from './LoginGate.tsx'
import { fetchIdentity } from './session.ts'

/** 启动层品牌文案（应用首屏闪过的那一瞬间）。与登录页 LOGO 区分。 */
const SPLASH_BRAND = 'DSH 企业工作台'

/** apply 在模块激活时同步执行：先盖 splash，再异步探活决策。 */
export function apply(): void {
  void bootGate()
}

/** 本闸门不依赖任何 client 服务，空依赖即立即激活。 */
export const inject: string[] = []

async function bootGate(): Promise<void> {
  const body = await readyBody()
  const splash = mountSplash(body)
  let authenticated = false
  try {
    authenticated = (await fetchIdentity()) !== null
  } catch {
    // 探活网络异常：不阻断既有用户；撤掉 splash 交给应用自行表现。
    authenticated = true
  }
  splash.remove()
  if (authenticated) return
  const gate = document.createElement('div')
  gate.setAttribute('data-dsh-auth-gate', '')
  body.appendChild(gate)
  createRoot(gate).render(createElement(LoginGate))
}

/** 等待 document.body 就绪（client 模块可能先于 DOMContentLoaded 激活）。 */
function readyBody(): Promise<HTMLElement> {
  const existing = document.body
  if (existing !== null) return Promise.resolve(existing)
  return new Promise((resolve) => {
    const onReady = (): void => {
      const body = document.body
      if (body === null) return
      document.removeEventListener('DOMContentLoaded', onReady)
      resolve(body)
    }
    document.addEventListener('DOMContentLoaded', onReady)
  })
}

/** 品牌启动层：纯 DOM（不引 React），铺满视口、置于应用与登录页之下。 */
function mountSplash(body: HTMLElement): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-dsh-auth-splash', '')
  const style: Partial<CSSStyleDeclaration> = {
    position: 'fixed',
    inset: '0',
    zIndex: '2000000000',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f2f6fb',
    color: '#274b73',
    font: '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    gap: '14px',
  }
  for (const [key, value] of Object.entries(style)) {
    if (typeof value === 'string') el.style.setProperty(key, value)
  }
  const label = document.createElement('div')
  label.textContent = SPLASH_BRAND
  el.appendChild(label)
  body.appendChild(el)
  return el
}
