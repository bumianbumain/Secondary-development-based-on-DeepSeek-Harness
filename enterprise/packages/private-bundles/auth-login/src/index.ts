/**
 * @my-company/auth-login — 企业「外圈登录权限页」Bundle 的 node 半。
 *
 * 职责：把 {@link AuthProvider} 挂到 ctx.root 上，让核心 BrowserAuth 的 /login
 * 有凭证校验后端可用。凭证校验委托 @my-company/biz-user 的 SQL 用户数据源
 * （authenticate(username, password)，scrypt 加盐哈希，读 USER_DB_MSSQL 连接串）。
 *
 * 时序说明：
 *   - 本 Bundle 在 client-connection（dsh-web-app）之后、且挂在 sibling 插件分支，
 *     因此核心 BrowserAuth 不能在本插件 apply 时捕获 provider——它改为在请求时
 *     从 ctx.root 懒读取（见 packages/client/connection/src/browser-auth.ts 的
 *     `provider` getter）。此处用 ctx.root.provide 挂载，任何后续请求都能读到。
 *   - 数据源也刻意延迟到首次 verify 才创建（getUserDataSource 每次现取），启动时
 *     即使 USER_DB_MSSQL 未配置也不会让整棵插件树崩溃——首个登录请求会得到明确报错。
 *
 * 客户端半（登录页 UI）在 ./client，由 dsh.client manifest 编入浏览器模块表。
 *
 * @module @my-company/auth-login
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AuthProvider } from '@deepseek-ai/dsh-client-connection'
import { getUserDataSource } from '@my-company/biz-user'
import { SIGNIN_PAGE_HTML } from './signin-page.ts'

/** 稳定 Cordis 插件名，须与 cordis.patch.yml 中插入行的 `name` 一致。 */
export const name = 'auth-login'

/** 挂载凭证校验器到根上下文；BrowserAuth 在 /login 请求时懒读取。 */
export function apply(ctx: Context): void {
  const provider: AuthProvider = {
    verify: async (credentials) => {
      const ds = getUserDataSource()
      const result = await ds.authenticate(credentials.username, credentials.password)
      if (result === null) return null
      return { userId: result.userId, roles: result.roles }
    },
  }
  // root.provide 注册一个“由当前 fiber 拥有”的服务：auth-login 插件存活期间
  // provider 对整棵插件树可见；插件卸载时自动注销。
  ctx.root.provide('authProvider', provider)
  // 自包含登录页 HTML：核心 webServer 在未认证访问 `/` 时 302 到 `/signin`
  // 并下发本页（GET /signin 路由懒读取）。与 authProvider 同款懒读取模式——
  // 本插件晚于核心加载，构造期捕获不可行。
  ctx.root.provide('signinPageHtml', SIGNIN_PAGE_HTML)
}
