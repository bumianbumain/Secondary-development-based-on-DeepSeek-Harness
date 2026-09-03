/** Enterprise business-plugins panel — browser half injected into Settings → Plugins. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { BizPluginsPanelTab, type BizPluginsInjected } from './BizPluginsPanelTab.tsx'
import { en, zh, type BizPluginsLocaleKey } from './locales.ts'

export type { BizPluginsInjected, BizPluginsProps } from './BizPluginsPanelTab.tsx'
export type { BizPluginsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Enterprise business-plugins panel copy. */
    'enterprise.bizPlugins': BizPluginsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'enterprise.bizPlugins'

/** Services required by the Settings registration. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

/** Contribute the enterprise business-plugins tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'biz-plugins-panel: dictionaries')

  const t = ctx.locale.bind(NS)
  const injected = (): BizPluginsInjected => ({
    list: async () => {
      const result = await ctx.remote.pluginInventory.list()
      if (!result.ok) {
        throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
  })

  // Inject as a sibling tab of the existing "插件列表" tab, ordered right after it.
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'enterprise-biz',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, BizPluginsPanelTab))
}
