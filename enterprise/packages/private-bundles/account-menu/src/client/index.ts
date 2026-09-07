/**
 * account-menu 浏览器半入口。
 *
 * 模块激活时通过 ctx.slots.inject('sidebar.footer.action', …) 把 AccountCard
 * 注册到侧边栏底部的"附加操作"列表。SidebarRoot 会自动渲染它。
 *
 * 不依赖任何额外服务（apply 只用 ctx.slots），但仍把 slots 写入 inject 列表以
 * 满足 client 模块系统的依赖解析。
 *
 * @module @my-company/account-menu/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { AccountCardSlot } from './AccountCard.tsx'

/** 注入依赖：本客户端半仅需 ctx.slots 用于槽位注册。 */
export const inject: string[] = ['slots']

/**
 * 注册 sidebar.footer.action 槽位的贡献者。
 *
 * SidebarRoot 把 sidebar.footer.action 列表渲染在 settings 项**上方**；本组件
 * 因此在视觉上紧贴"设置"项之上、footer 区域的底部。具体效果：
 *
 *   [品牌区]
 *   …
 *   [workspace/session list]
 *
 *   [AccountCard（本组件）]   ← 注册到 footer.action，位于此位
 *   [设置]                     ← ui-settings-general 注册到 sidebar.settings
 *
 * 侧边栏列宽 wide=true 渲染完整账号卡，wide=false 折叠为只显示头像圆。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    // list slot 注册必填 id（参照 ui-settings-general 注册 settings.action 写法）；
    // id 同时作为该 entry 的稳定身份，sidebar 渲染 list 时按 id+order 排序。
    id: 'account-menu',
    // 较低 order 排在列表靠前；不与现有 footer.action 冲突（当前 sidebar 没有
    // 其他 footer.action 注册者——此 slot 在 dsh 上游是空列表）。
    order: 10,
    label: () => '账号菜单',
  }, AccountCardSlot))
}
