/**
 * 加用户弹窗：admin 角色在 sidebar 账号菜单里点"加用户"时弹出。
 *
 * 字段：
 *   - 姓名 *     必填
 *   - 邮箱 *     必填 + 简单格式校验
 *   - 用户 ID    留空则后端按 U-NNN 自动生成
 *   - 初始密码 * 至少 6 位
 *   - 角色       多选（admin/operator/viewer/finance），默认 viewer
 *
 * 流程：
 *   1. 打开时拉 GET /api/biz-user/list 展示"已有用户"（仅参考，不阻止创建）
 *   2. 提交时 POST /api/biz-user/create，成功关弹窗；失败显示 error。
 */

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { createUser, listUsers, type UserProfile } from './session.ts'

const BRAND_BLUE = '#24478C'
const BRAND_BLUE_DARK = '#0D2152'
const INPUT_BORDER = 'rgba(15, 23, 42, 0.12)'
const INPUT_FOCUS_BORDER = BRAND_BLUE
const TEXT_PRIMARY = 'rgba(15, 23, 42, 0.95)'
const TEXT_SECONDARY = 'rgba(15, 23, 42, 0.6)'
const DANGER = '#dc2626'

const ROLES: Array<{ value: string; label: string }> = [
  { value: 'admin', label: 'admin（管理员）' },
  { value: 'operator', label: 'operator（操作员）' },
  { value: 'viewer', label: 'viewer（只读）' },
  { value: 'finance', label: 'finance（财务）' },
]

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
}

const panelStyle: CSSProperties = {
  width: 480,
  maxWidth: '90vw',
  maxHeight: '90vh',
  overflowY: 'auto',
  background: '#FFFFFF',
  borderRadius: 14,
  boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
  padding: 24,
  boxSizing: 'border-box',
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
  color: TEXT_PRIMARY,
}

const subtitleStyle: CSSProperties = {
  marginTop: 4,
  marginBottom: 16,
  fontSize: 13,
  color: TEXT_SECONDARY,
}

const fieldStyle: CSSProperties = {
  marginBottom: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: TEXT_PRIMARY,
}

const inputStyle: CSSProperties = {
  height: 36,
  borderRadius: 8,
  border: `1px solid ${INPUT_BORDER}`,
  padding: '0 10px',
  font: 'inherit',
  fontSize: 14,
  color: TEXT_PRIMARY,
  outline: 'none',
  background: '#FFFFFF',
  boxSizing: 'border-box',
}

const rolesRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
}

const roleChipStyle = (active: boolean): CSSProperties => ({
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 999,
  border: `1px solid ${active ? BRAND_BLUE : INPUT_BORDER}`,
  background: active ? 'rgba(36, 71, 140, 0.1)' : '#FFFFFF',
  color: active ? BRAND_BLUE : TEXT_PRIMARY,
  cursor: 'pointer',
  font: 'inherit',
})

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 20,
}

const primaryBtnStyle: CSSProperties = {
  height: 36,
  padding: '0 18px',
  borderRadius: 8,
  background: BRAND_BLUE,
  color: '#FFFFFF',
  border: 0,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
}

const secondaryBtnStyle: CSSProperties = {
  ...primaryBtnStyle,
  background: '#FFFFFF',
  color: TEXT_PRIMARY,
  border: `1px solid ${INPUT_BORDER}`,
}

const errorStyle: CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: DANGER,
}

const existingUserListStyle: CSSProperties = {
  marginTop: 4,
  maxHeight: 80,
  overflowY: 'auto',
  fontSize: 12,
  color: TEXT_SECONDARY,
  background: 'rgba(15, 23, 42, 0.03)',
  borderRadius: 6,
  padding: 8,
}

interface Props {
  onClose: () => void
  onCreated: (user: UserProfile) => void
}

export function AddUserDialog({ onClose, onCreated }: Props): JSX.Element {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [roles, setRoles] = useState<string[]>(['viewer'])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existing, setExisting] = useState<UserProfile[]>([])

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  // 拉已有用户（仅参考）
  useEffect(() => {
    void listUsers()
      .then((res) => setExisting(res.users))
      .catch(() => { /* 静默失败：拉不到也不阻塞表单 */ })
  }, [])

  function toggleRole(role: string): void {
    setRoles((cur) => cur.includes(role) ? cur.filter(r => r !== role) : [...cur, role])
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (submitting) return
    setError(null)
    if (!name.trim()) { setError('请输入姓名'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('邮箱格式不正确'); return }
    if (password.length < 6) { setError('密码至少 6 位'); return }
    if (roles.length === 0) { setError('至少选择一个角色'); return }

    setSubmitting(true)
    try {
      const res = await createUser({
        name: name.trim(),
        email: email.trim(),
        user_id: userId.trim() || undefined,
        password,
        roles,
      })
      if (!res.ok || !res.user) {
        const code = res.error ?? 'create_failed'
        const msg = res.message ? `（${res.message}）` : ''
        setError(`创建失败：${code}${msg}`)
        setSubmitting(false)
        return
      }
      onCreated(res.user)
    } catch (err) {
      setError((err as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="add-user-title">
      <form style={panelStyle} onSubmit={onSubmit} noValidate>
        <h2 id="add-user-title" style={titleStyle}>加用户</h2>
        <p style={subtitleStyle}>为 demo 租户新建一个用户并设置初始密码。创建后可立即登录。</p>

        <div style={fieldStyle}>
          <label style={labelStyle}>姓名 *</label>
          <input
            style={inputStyle}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="如 张伟"
            autoFocus
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>邮箱 *</label>
          <input
            style={inputStyle}
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="zhangwei@example.com"
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>用户 ID（留空则自动生成 U-NNN）</label>
          <input
            style={inputStyle}
            type="text"
            value={userId}
            onChange={e => setUserId(e.target.value)}
            placeholder="U-101"
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>初始密码 *（至少 6 位）</label>
          <input
            style={inputStyle}
            type="text"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="建议使用临时密码，首次登录后引导修改"
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>角色（可多选）</label>
          <div style={rolesRowStyle}>
            {ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                style={roleChipStyle(roles.includes(r.value))}
                onClick={() => toggleRole(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {existing.length > 0 && (
          <div style={fieldStyle}>
            <label style={labelStyle}>已有用户（参考）</label>
            <div style={existingUserListStyle}>
              {existing.map(u => (
                <div key={u.id} style={{ padding: '2px 0' }}>
                  {u.id} · {u.name} · {u.email} · {u.roles.join('/')}
                </div>
              ))}
            </div>
          </div>
        )}

        {error !== null && <div style={errorStyle}>{error}</div>}

        <div style={buttonRowStyle}>
          <button type="button" style={secondaryBtnStyle} onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button type="submit" style={primaryBtnStyle} disabled={submitting}>
            {submitting ? '创建中…' : '创建'}
          </button>
        </div>
      </form>
    </div>
  )
}
