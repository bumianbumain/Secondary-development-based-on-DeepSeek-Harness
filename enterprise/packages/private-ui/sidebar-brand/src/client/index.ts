/**
 * Enterprise sidebar brand — browser half injected into the sidebar brand slots.
 *
 * Registers occupants for `sidebar.brand.mark` (replaces the shell's fish
 * fallback) and `sidebar.brand.name` (replaces the local-build label), exactly
 * the way the official brand does — but unconditionally, because this is an
 * enterprise deployment override, not the official build's artwork.
 *
 * @module @my-company/sidebar-brand/client
 */

import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { EnterpriseBrandMark, EnterpriseBrandName } from './Brand.tsx'

export { EnterpriseBrandMark, EnterpriseBrandName } from './Brand.tsx'

/** Service required by the sidebar brand registration. */
export const inject = ['slots']

/**
 * Contribute the enterprise mark + name to the sidebar's two brand holes.
 * The outer `inject('sidebar.brand.mark', …)` defers the whole registration set
 * until the brand row renders; the inner generator yields both register()
 * disposers so the pair mounts/unmounts atomically.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, EnterpriseBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, EnterpriseBrandName)
    }))
}
