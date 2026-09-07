/** Enterprise brand artwork — a corporate mark + wordmark for the sidebar brand slots. */

import type {
  SidebarBrandMarkOwnerProps,
  SidebarBrandNameOwnerProps,
} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * —— 品牌定制点 ——
 * 把下面三个常量换成贵司品牌信息即可（或后续接入 server→client 品牌配置通道），
 * 无需改动注册逻辑与 slot 契约。
 */
/** 展开态显示的主产品名（与登录页 /signin 品牌口径保持一致）。 */
export const ENTERPRISE_PRODUCT_NAME = 'HubPM'
/** 主名旁的英文小标；留空则不渲染（避免窄侧栏下被截断）。 */
export const ENTERPRISE_PRODUCT_SUB = ''
/** 品牌方块（mark）里的首字；留空则只画纯色方块。 */
export const ENTERPRISE_BRAND_GLYPH = 'H'

/**
 * 企业品牌标：圆角方块 + 品牌首字，占满 shell 传入的 size（展开品牌行与折叠 rail
 * 均以 size=24 渲染，替换官方的 FishLogo fallback）。
 * 颜色全部走 dsw design token，深浅主题自适应。
 */
export function EnterpriseBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={ENTERPRISE_PRODUCT_NAME}
    >
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="23"
        rx="7"
        fill="var(--dsw-alias-state-business-primary)"
      />
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="23"
        rx="7"
        stroke="color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent)"
        strokeWidth="1"
      />
      {ENTERPRISE_BRAND_GLYPH.length > 0 ? (
        <text
          x="12"
          y="12.4"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="13"
          fontWeight="700"
          fill="var(--dsw-alias-label-primary-inverted)"
        >
          {ENTERPRISE_BRAND_GLYPH}
        </text>
      ) : null}
    </svg>
  )
}

/**
 * 企业品牌名：主名 + 英文小标一行排布（owner 只声明宽度，内容由 occupant 自持），
 * 替换 shell 的本地构建名 fallback。
 */
export function EnterpriseBrandName(_props: SidebarBrandNameOwnerProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          fontSize: '16px',
          fontWeight: 700,
          lineHeight: '24px',
          letterSpacing: '0.01em',
          color: 'var(--dsw-alias-label-primary)',
        }}
      >
        {ENTERPRISE_PRODUCT_NAME}
      </span>
      {ENTERPRISE_PRODUCT_SUB.length > 0 ? (
        <span
          style={{
            fontSize: '9px',
            fontWeight: 600,
            lineHeight: '24px',
            letterSpacing: '0.14em',
            color: 'var(--dsw-alias-label-tertiary)',
          }}
        >
          {ENTERPRISE_PRODUCT_SUB}
        </span>
      ) : null}
    </span>
  )
}
