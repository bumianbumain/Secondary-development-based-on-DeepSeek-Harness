/**
 * 账号卡：侧边栏底部的"用户名 + 头像圆 + 原生 ⚙ 设置 + 下拉菜单"区块。
 *
 * 视觉：
 *   - 账号卡（占主部）与**原生 sidebar.settings 的 trigger**同行一左一右，
 *     触发行为完全沿用原 trigger（hover、active、点击弹窗全部走原组件）。
 *   - 账号卡下方不再有独立的"⚙ 设置"行。
 *   - 点击账号卡打开下拉菜单，菜单里只一个动作：退出账号。
 *
 * 实现要点：
 *   - DOM 重组：mount 时把原 .settingsArea 节点从 .footArea 里拔出，
 *     挂到 AccountCard wrapper 的 sibling 位置形成 flex row。
 *   - 用 MutationObserver 拦截 React 重渲染持续搬运。
 *   - 这样既不动 core css，又保留原 sidebar.settings trigger 的完整行为。
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import { fetchIdentity } from './session.ts'

interface Identity {
  userId: string
  roles: string[]
}

const BRAND_BLUE = '#24478C'
const TEXT_PRIMARY = 'rgba(15, 23, 42, 0.95)'
const TEXT_SECONDARY = 'rgba(15, 23, 42, 0.55)'
const CARD_BG = 'rgba(255, 255, 255, 0.7)'
const CARD_BG_HOVER = 'rgba(255, 255, 255, 0.95)'
const CARD_BORDER = 'rgba(15, 23, 42, 0.08)'
const MENU_BG = '#ffffff'
const MENU_BORDER = 'rgba(15, 23, 42, 0.08)'
const MENU_SHADOW = '0 8px 24px rgba(15, 23, 42, 0.12)'
const DANGER = '#dc2626'

function avatarLetter(id: string): string {
  if (!id) return '?'
  return id.charAt(0).toUpperCase()
}

const cardStyle = (wide: boolean, open: boolean): CSSProperties => ({
  width: '100%',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: wide ? 10 : 0,
  padding: wide ? '8px 10px' : '6px',
  borderRadius: 10,
  background: open ? CARD_BG_HOVER : CARD_BG,
  border: `1px solid ${CARD_BORDER}`,
  cursor: 'pointer',
  font: 'inherit',
  color: TEXT_PRIMARY,
  textAlign: 'left',
  transition: 'background 120ms ease, box-shadow 120ms ease',
  boxShadow: open ? '0 2px 6px rgba(15, 23, 42, 0.06)' : 'none',
})

const avatarStyle: CSSProperties = {
  width: 28,
  height: 28,
  flex: '0 0 28px',
  borderRadius: '50%',
  background: `linear-gradient(135deg, ${BRAND_BLUE} 0%, #0D2152 100%)`,
  color: '#FFFFFF',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  fontWeight: 600,
}

const userIdStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: '1 1 auto',
  minWidth: 0,
}

const roleBadgeStyle: CSSProperties = {
  fontSize: 10,
  padding: '1px 6px',
  borderRadius: 999,
  background: 'rgba(36, 71, 140, 0.1)',
  color: BRAND_BLUE,
  fontWeight: 500,
  flex: '0 0 auto',
}

function menuStyle(wide: boolean): CSSProperties {
  return {
    position: 'absolute',
    bottom: 'calc(100% + 6px)',
    left: wide ? 8 : '50%',
    transform: wide ? 'none' : 'translateX(-50%)',
    minWidth: wide ? 160 : 140,
    background: MENU_BG,
    border: `1px solid ${MENU_BORDER}`,
    borderRadius: 10,
    boxShadow: MENU_SHADOW,
    padding: 4,
    zIndex: 1000,
    fontSize: 13,
  }
}

const menuItemStyle: CSSProperties = {
  width: '100%',
  border: 0,
  background: 'transparent',
  padding: '8px 10px',
  borderRadius: 6,
  textAlign: 'left',
  cursor: 'pointer',
  color: TEXT_PRIMARY,
  font: 'inherit',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const menuItemDangerStyle: CSSProperties = {
  ...menuItemStyle,
  color: DANGER,
}

const wrapperStyle: CSSProperties = {
  width: '100%',
  position: 'relative',
}

/**
 * 把原 .settingsArea 节点从 .footArea 里拔出，挂到 AccountCard wrapper 的 sibling
 * 位置形成 flex row。监听 React 重渲染持续拦截。
 */
function useBridgedSettingsArea(wrapper: React.RefObject<HTMLDivElement>): void {
  useEffect(() => {
    const host = wrapper.current
    if (!host) return
    const footArea = host.closest<HTMLElement>('[class*="footArea"], [class*="foot_area"]')
      ?? host.parentElement?.parentElement
    if (!footArea) return
    const settingsArea = footArea.querySelector<HTMLElement>('[class*="settingsArea"], [class*="settings_area"]')
    if (!settingsArea) return

    const moved = settingsArea
    const rowHost = host.parentElement
    if (!rowHost) return

    function rebind(): void {
      if (moved.parentElement !== rowHost) rowHost?.appendChild(moved)
    }
    rebind()

    const mo = new MutationObserver(() => {
      if (moved.parentElement !== rowHost) rebind()
    })
    mo.observe(footArea, { childList: true, subtree: false })

    return () => {
      mo.disconnect()
      if (moved.parentElement !== footArea) footArea.appendChild(moved)
    }
  }, [wrapper])
}

function AccountCard({ wide }: { wide: boolean }): JSX.Element | null {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void fetchIdentity().then(id => setIdentity(id as Identity | null))
  }, [])

  useBridgedSettingsArea(wrapper)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => { document.removeEventListener('mousedown', onDoc) }
  }, [open])

  if (identity === null) {
    return (
      <div ref={wrapper} style={wrapperStyle} aria-hidden>
        <div style={cardStyle(wide, false)}>
          <span style={{ ...avatarStyle, opacity: 0.5 }}>?</span>
          {wide && <span style={{ ...userIdStyle, color: TEXT_SECONDARY }}>…</span>}
        </div>
      </div>
    )
  }

  function onLogout(): void {
    setOpen(false)
    void fetch('/logout', { method: 'GET', credentials: 'include', redirect: 'manual' })
      .catch(() => {})
      .finally(() => { window.location.assign('/signin') })
  }

  return (
    <div ref={wrapper} style={wrapperStyle}>
      {open && (
        <div style={menuStyle(wide)} role="menu" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            style={menuItemDangerStyle}
            onClick={onLogout}
          >
            <span aria-hidden style={{ width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, opacity: 0.7 }}>⏻</span>
            <span>退出账号</span>
          </button>
        </div>
      )}
      <button
        type="button"
        style={cardStyle(wide, open)}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={identity.userId}
      >
        <span style={avatarStyle} aria-hidden>{avatarLetter(identity.userId)}</span>
        {wide && (
          <>
            <span style={userIdStyle}>{identity.userId}</span>
            {identity.roles[0] && <span style={roleBadgeStyle}>{identity.roles[0]}</span>}
          </>
        )}
      </button>
    </div>
  )
}

type Props = { wide: boolean }

export function AccountCardSlot(props: Props): JSX.Element {
  return <AccountCard wide={props.wide} />
}

export function mountAccountCardFallback(): void {
  const host = document.querySelector<HTMLElement>('[data-dsh-account-menu-fallback]')
  if (host === null) return
  createRoot(host).render(createElement(AccountCardSlot, { wide: true }))
}