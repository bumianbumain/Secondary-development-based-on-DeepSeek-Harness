import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** One plugin inventory row the Host reports for a loaded Cordis entry. */
type PluginEntry = PluginInventorySnapshot['entries'][number]
type FiberPhase = NonNullable<PluginEntry['fiberPhase']>

/** Registration-side Remote face used by this tab: a live inventory snapshot. */
export interface BizPluginsInjected {
  /** Read the current Host plugin inventory. */
  list: () => Promise<PluginInventorySnapshot>
}

/** Full component props assembled by the Settings slot renderer. */
export type BizPluginsProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'enterprise.bizPlugins'>
  & InjectFace<BizPluginsInjected>

type Translate = BizPluginsProps['t']

/** Static, build-time metadata for the three private business plugins. */
const BIZ_META: Record<string, { title: string; domain: string; desc: string; tools: string[] }> = {
  '@my-company/biz-order': {
    title: '订单中心',
    domain: 'biz-order',
    desc: '企业订单域：查询订单、订单明细、订单状态等测试工具（mock 数据源）。',
    tools: ['query_user_orders', 'query_order_detail', 'query_order_status'],
  },
  '@my-company/biz-user': {
    title: '用户中心',
    domain: 'biz-user',
    desc: '企业用户域：用户档案、角色列表等测试工具（mock 数据源）。',
    tools: ['query_user_profile', 'list_user_roles'],
  },
  '@my-company/biz-knowledge': {
    title: '知识中心',
    domain: 'biz-knowledge',
    desc: '企业知识库：知识检索、文档查询、分类与标签等测试工具（mock 数据源）。',
    tools: ['search_knowledge', 'query_knowledge_doc', 'list_knowledge_categories', 'list_knowledge_tags'],
  },
}

/** Localized label for one root Fiber phase. */
const PHASE_LABEL: Record<FiberPhase, string> = {
  pending: '等待依赖',
  loading: '加载中',
  active: '运行中',
  failed: '启动失败',
  unloading: '卸载中',
}

/** Inline styles use the same dsw design tokens as the core UI, so they adapt to light/dark. */
const s = {
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    width: '100%',
    maxWidth: '760px',
    color: 'var(--dsw-alias-label-primary)',
  } as const,
  status: {
    margin: 0,
    fontSize: '13px',
    lineHeight: '20px',
    color: 'var(--dsw-alias-label-tertiary)',
  } as const,
  failure: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    color: 'var(--dsw-alias-state-error-primary)',
    fontSize: '13px',
  } as const,
  search: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    color: 'var(--dsw-alias-label-tertiary)',
  } as const,
  searchInput: {
    width: '100%',
    height: '36px',
    border: '0.5px solid var(--dsw-alias-border-l4)',
    borderRadius: '10px',
    padding: '0 14px 0 36px',
    outline: 'none',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
    font: 'inherit',
    fontSize: '13px',
  } as const,
  intro: {
    margin: 0,
    fontSize: '12.5px',
    lineHeight: '19px',
    color: 'var(--dsw-alias-label-tertiary)',
  } as const,
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    alignItems: 'start',
    gap: '10px',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  } as const,
  card: {
    minWidth: 0,
    overflow: 'hidden',
    border: '0',
    boxShadow: 'var(--dsw-elevation-stroke)',
    borderRadius: '14px',
    background: 'var(--dsw-alias-bg-layer-3)',
  } as const,
  cardOpen: {
    boxShadow: 'var(--dsw-elevation-panel)',
  } as const,
  cardContent: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    width: '100%',
    minHeight: '52px',
    border: 0,
    padding: '12px 14px',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left' as const,
    cursor: 'pointer',
  },
  cardTitle: {
    minWidth: 0,
    overflow: 'hidden',
    fontSize: '14px',
    lineHeight: '20px',
    fontWeight: 600,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as const,
  cardTrailing: {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    gap: '7px',
    color: 'var(--dsw-alias-label-tertiary)',
  } as const,
  dot: {
    display: 'inline-block',
    width: '7px',
    height: '7px',
    flex: 'none',
    borderRadius: '999px',
    background: 'var(--dsw-alias-label-tertiary)',
  } as const,
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '20px',
    borderRadius: '5px',
    padding: '1px 6px',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: '11px',
    lineHeight: '16px',
    whiteSpace: 'nowrap' as const,
  } as const,
  chevron: {
    flex: 'none',
    color: 'var(--dsw-alias-label-tertiary)',
    transition: 'transform 140ms var(--ds-ease-in-out)',
  } as const,
  details: {
    borderTop: '0.5px solid var(--dsw-alias-border-l2)',
    padding: '10px 14px 12px',
    background: 'var(--dsw-alias-bg-module-platform)',
  } as const,
  desc: {
    margin: '0 0 10px',
    fontSize: '12.5px',
    lineHeight: '18px',
    color: 'var(--dsw-alias-label-secondary)',
  } as const,
  dl: {
    display: 'grid',
    gridTemplateColumns: '76px minmax(0, 1fr)',
    gap: '6px 10px',
    margin: 0,
  } as const,
  dt: {
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: '11px',
    lineHeight: '17px',
  } as const,
  dd: {
    minWidth: 0,
    margin: 0,
    overflowWrap: 'anywhere',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: '12px',
    lineHeight: '17px',
  } as const,
  code: {
    fontFamily: 'var(--ds-font-family-code)',
    fontSize: '11.5px',
  } as const,
  tools: {
    margin: '8px 0 0',
    padding: 0,
    listStyle: 'none',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '5px',
  } as const,
  toolChip: {
    display: 'inline-block',
    padding: '1px 7px',
    borderRadius: '5px',
    background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent)',
    color: 'var(--dsw-alias-state-business-primary)',
    fontFamily: 'var(--ds-font-family-code)',
    fontSize: '11px',
  } as const,
}

function Chevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      style={{ ...s.chevron, transform: open ? 'rotate(180deg)' : 'none' }}
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

/**
 * Standalone accordion tab inside Settings → Plugins, listing ONLY the private
 * `@my-company/*` business plugins (biz-order / biz-user / biz-knowledge) as a
 * fold-out panel. Pure read-only; pulls live inventory from the Host.
 */
export function BizPluginsPanelTab({ list, t }: BizPluginsProps): ReactNode {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [request, setRequest] = useState(0)

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const normalized = query.trim().toLocaleLowerCase()
  const entries = state.status === 'ready' ? state.snapshot.entries : []
  const bizEntries = useMemo(
    () => entries.filter((e) => e.moduleName.startsWith('@my-company/')),
    [entries],
  )
  const filtered = useMemo(
    () => bizEntries.filter((e) => {
      if (normalized.length === 0) return true
      const meta = BIZ_META[e.moduleName]
      return e.moduleName.toLocaleLowerCase().includes(normalized)
        || (meta?.title ?? '').toLocaleLowerCase().includes(normalized)
        || (meta?.domain ?? '').toLocaleLowerCase().includes(normalized)
    }),
    [bizEntries, normalized],
  )

  const retry = (): void => { setState({ status: 'loading' }); setRequest((v) => v + 1) }
  const toggle = (key: string): void => { setExpanded((c) => (c === key ? null : key)) }

  return (
    <div style={s.section} aria-busy={state.status === 'loading'}>
      <p style={s.intro}>
        {t('intro')}
      </p>
      {state.status === 'loading' ? <p style={s.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div style={s.failure}>
          <span role="alert">{t('error')}</span>
          <button type="button" onClick={retry} style={{ ...s.tag, cursor: 'pointer', border: '0.5px solid var(--dsw-alias-border-l3)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit' }}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <label style={s.search}>
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none" style={{ position: 'absolute', left: 12, pointerEvents: 'none' }} aria-hidden="true">
              <circle cx={7} cy={7} r={4.5} stroke="currentColor" strokeWidth="1.3" />
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <input
              style={s.searchInput}
              type="search"
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(e) => { setQuery(e.currentTarget.value) }}
            />
          </label>
          {filtered.length === 0 ? <p style={s.status}>{t('emptySearch')}</p> : (
            <ul style={s.cards}>
              {filtered.map((entry) => {
                const key = entry.entryId ?? entry.moduleName
                const open = expanded === key
                const meta = BIZ_META[entry.moduleName]
                const failed = entry.fiberPhase === 'failed'
                const phase = entry.fiberPhase
                const stateText = failed
                  ? t('failedTag')
                  : entry.enabled
                    ? t('enabledTag')
                    : t('disabledTag')
                const kind = failed ? 'failed' : entry.enabled ? 'enabled' : 'disabled'
                const dotColor = phase === 'active'
                  ? 'var(--dsw-alias-state-success-primary)'
                  : phase === 'failed'
                    ? 'var(--dsw-alias-state-error-primary)'
                    : phase === 'loading'
                      ? 'var(--dsw-alias-state-business-primary)'
                      : 'var(--dsw-alias-label-tertiary)'
                return (
                  <li key={key} style={{ ...s.card, ...(open ? s.cardOpen : {}) }} data-plugin-module={entry.moduleName}>
                    <button
                      type="button"
                      style={s.cardContent}
                      aria-expanded={open}
                      aria-label={`${meta?.title ?? entry.moduleName}, ${stateText}`}
                      onClick={() => { toggle(key) }}
                    >
                      <strong style={s.cardTitle} title={meta?.title ?? entry.moduleName}>
                        {meta?.title ?? entry.moduleName}
                      </strong>
                      <span style={s.cardTrailing}>
                        {phase !== null ? <span style={{ ...s.dot, background: dotColor }} aria-hidden="true" /> : null}
                        <span style={{ ...s.tag, color: tagColor(kind), background: tagBg(kind) }}>{stateText}</span>
                        <Chevron open={open} />
                      </span>
                    </button>
                    {open ? (
                      <div style={s.details}>
                        <p style={s.desc}>{meta?.desc ?? ''}</p>
                        <dl style={s.dl}>
                          <div><dt style={s.dt}>{t('moduleLabel')}</dt><dd style={s.dd}><code style={s.code}>{entry.moduleName}</code></dd></div>
                          <div><dt style={s.dt}>{t('entryLabel')}</dt><dd style={s.dd}><code style={s.code}>{entry.entryId ?? '—'}</code></dd></div>
                          <div><dt style={s.dt}>{t('configLabel')}</dt><dd style={s.dd}>{stateText}</dd></div>
                          <div><dt style={s.dt}>{t('runtimeLabel')}</dt><dd style={s.dd}>{phase === null ? t('unobserved') : PHASE_LABEL[phase]}</dd></div>
                          <div><dt style={s.dt}>{t('domainLabel')}</dt><dd style={s.dd}>{meta?.domain ?? '—'}</dd></div>
                        </dl>
                        {meta?.tools?.length ? (
                          <>
                            <dt style={{ ...s.dt, marginTop: '8px' }}>{t('toolsLabel')}</dt>
                            <ul style={s.tools}>
                              {meta.tools.map((tool) => (
                                <li key={tool} style={s.toolChip}>{tool}</li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      ) : null}
    </div>
  )
}

function tagColor(kind: string): string {
  if (kind === 'enabled') return 'var(--dsw-alias-state-success-primary)'
  if (kind === 'failed') return 'var(--dsw-alias-state-error-primary)'
  if (kind === 'disabled') return 'var(--dsw-alias-label-secondary)'
  return 'var(--dsw-alias-state-business-primary)'
}
function tagBg(kind: string): string {
  if (kind === 'enabled') return 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent)'
  if (kind === 'failed') return 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)'
  if (kind === 'disabled') return 'var(--dsw-alias-bg-layer-1)'
  return 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent)'
}
