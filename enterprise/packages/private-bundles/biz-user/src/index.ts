/**
 * @my-company/biz-user — 企业用户/账户业务 Bundle（多 Bundle 扩展示例）
 *
 * 与 biz-order 完全相同的分层模式：不修改 DSH 核心源码，向工具注册表注入一组
 * 用户业务工具，多租户隔离基于 exec.agent?.session?.id。数据源同样经由
 * datasource.ts 的 UserDataSource 抽象，便于未来切换真实中台。
 *
 * 装配顺序：dsh-base → dsh-web-app → biz-order → 本 Bundle（按 profile 的 bundles 列表）。
 *
 * @module @my-company/biz-user
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { getUserDataSource } from './datasource.js'
import type { UserProfile, UserRole } from './types'

/** 稳定 Cordis 插件名，须与 cordis.patch.yml 中插入行的 `name` 一致。 */
export const name = 'biz-user'

/** 仅依赖 tools 服务（dsh-base 已提供）；声明后 `apply` 才能拿到 `ctx.tools`。 */
export const inject = ['tools']

/**
 * 从执行上下文解析租户标识。
 * 有会话时严格按会话隔离；无会话（如 CLI 冒烟测试）回退 'demo' 以打通测试链路。
 * 设 USER_TENANT 可强制指定租户作为演示开关（查询仍始终带 tenant 过滤，隔离语义不变）。
 */
function resolveTenant(exec: ToolRunContext): string {
  const forced = process.env.USER_TENANT
  if (forced) return forced
  return exec.agent?.session?.id ?? 'demo'
}

/** Bundle 插件入口：注册业务工具并登记资源生命周期。 */
export function apply(ctx: Context): void {
  // 资源生命周期：用 ctx.effect 登记连接，卸载时按反序自动清理（DSH 强制要求，防泄漏）。
  ctx.effect(() => {
    // 真实场景：const conn = internalApi.connect()
    return () => {
      // 真实场景：conn.close()
    }
  })

  const ds = getUserDataSource()

  // —— 工具 1：用户档案查询（按关键字/角色筛选） ——
  ctx.tools.register(defineTool({
    name: 'query_user_profile',
    description:
      '查询当前租户/会话下的用户档案与角色，可按姓名/邮箱/ID 关键字或角色筛选。'
      + '当用户询问"某人是谁""某某的角色权限""团队有哪些管理员"时使用。返回结果按当前会话隔离。',
    parameters: {
      keyword: {
        type: 'string',
        description: '姓名 / 邮箱 / 用户 ID 关键字，如 张伟 或 U-001。',
      },
      role: {
        type: 'string',
        enum: ['admin', 'operator', 'viewer', 'finance'],
        description: '按角色筛选；省略则返回全部角色。',
      },
      limit: {
        type: 'number',
        description: '返回条数上限，默认 10。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec)
      const users = await ds.listUsers(tenant, {
        role: args.role as UserRole | undefined,
        keyword: args.keyword,
      }, args.limit)
      return { tenant, count: users.length, users } as any
    },
  }))

  // —— 工具 2：角色枚举（轻量元数据工具，演示扩展模式） ——
  ctx.tools.register(defineTool({
    name: 'list_user_roles',
    description: '列出系统支持的用户角色枚举值，供上层对话或表单使用。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec: ToolRunContext) {
      return { tenant: resolveTenant(exec), roles: ds.listRoles() } as any
    },
  }))

  // —— 工具 3：创建用户（写入闭环：工具 → 数据源 → 数据库） ——
  ctx.tools.register(defineTool({
    name: 'create_user',
    description:
      '在当前租户/会话下新建一个用户档案并落库。当用户表达要新增成员、录入新用户、添加账号时使用。'
      + '需提供姓名与邮箱；角色默认 viewer（最小权限），状态默认 active。'
      + '写入后可用 query_user_profile 复查。',
    parameters: {
      name: {
        type: 'string',
        description: '用户姓名，必填。',
      },
      email: {
        type: 'string',
        description: '用户邮箱，必填，格式需合法。',
      },
      roles: {
        type: 'array',
        description: '角色列表；省略则默认 [' + "'viewer'" + ']（最小权限）。',
      },
      status: {
        type: 'string',
        enum: ['active', 'disabled'],
        description: '账号状态；省略则为 active。',
      },
      user_id: {
        type: 'string',
        description: '指定的用户 ID；省略则按 U-<序号> 自动生成。若与已有 ID 重复会报错。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const tenant = resolveTenant(exec)
      try {
        const user = await ds.createUser(tenant, {
          id: args.user_id,
          name: String(args.name ?? ''),
          email: String(args.email ?? ''),
          roles: Array.isArray(args.roles) ? args.roles as UserRole[] : undefined,
          status: args.status as UserProfile['status'] | undefined,
        })
        return { ok: true, tenant, user } as any
      } catch (e) {
        // 校验/落库失败都以结构化错误返回，避免把异常抛给模型导致链路中断
        return { ok: false, tenant, error: (e as Error).message } as any
      }
    },
  }))
}
