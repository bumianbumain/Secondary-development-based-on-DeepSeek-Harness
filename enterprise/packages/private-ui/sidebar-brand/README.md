# @my-company/sidebar-brand — 侧边栏企业品牌替换（第 4 层 UI 定制样板）

不改 upstream 前端源码，通过官方 slot 注入把 shell 侧边栏的 Logo 与产品名整体替换成
企业品牌。浏览器侧渲染实证已通过（见文末「验证」）。

## 原理

`@deepseek-ai/dsh-client-ui-sidebar` 声明两个品牌槽（`contract/slots.ts`）：

| 槽位 | 收的 props | shell 默认（fallback） |
| --- | --- | --- |
| `sidebar.brand.mark` | `{ size }` | `FishLogo size=24` + 本地构建名 |
| `sidebar.brand.name` | `{ children?: never }` | 本地构建名标签 |

官方 `ui-brand-official` 仅在 `DSH_CLIENT_BUILD_PROFILE==='official'` 才注册，因此企业包
可**无条件覆盖**。注册链与官方同构：

```ts
// src/client/index.ts
ctx.slots.inject('sidebar.brand.mark', () =>
  ctx.slots.inject('sidebar.brand.name', function* () {
    yield ctx.slots.register({ name: 'sidebar.brand.mark' }, EnterpriseBrandMark)
    yield ctx.slots.register({ name: 'sidebar.brand.name' }, EnterpriseBrandName)
  }))
```

## 品牌定制点（src/client/Brand.tsx 顶部常量）

| 常量 | 默认值 | 作用 |
| --- | --- | --- |
| `ENTERPRISE_BRAND_GLYPH` | `智` | 圆角方块 Logo 内的单字 |
| `ENTERPRISE_PRODUCT_NAME` | `智能体中台` | 侧边栏主产品名 |
| `ENTERPRISE_PRODUCT_SUB` | `ENTERPRISE AI PLATFORM` | 副标题（小型大写） |

颜色全部走 dsw design token（`--dsw-alias-state-business-primary` 等），自动适配深浅主题。
换品牌只需改这三个常量，注册逻辑不用动；后续可升级为 server→client 品牌配置通道。

## 双半构建

`tsdown.config.ts` 一次产出两个半：

- `lib/index.js` —— node 半，服务端装载（本包为纯 UI，`apply()` 为空）
- `lib/client.js` —— client 半，CJS 包裹在 `window.__ModuleLoader__.load({id, factory})`
  中；`react` / `react/jsx-runtime` / `@deepseek-ai/*` 全部 external，由 web 运行时模块表解析

`package.json` 关键字段：`dsh.bundle.patch`（corda 插件行）、`platform: 'web'`、
`dsh.client.inject: ['@deepseek-ai/dsh-client-ui-renderer','@deepseek-ai/dsh-client-ui-sidebar']`。

## 构建与接入

```sh
# 构建（Windows 下 tsdown 用仓库内绝对路径）
cd enterprise/packages/private-ui/sidebar-brand
node ../../../../node_modules/.pnpm/tsdown@0.22.2_oxc-resolver@_f113eb69000457c8d5954142d0822f52/node_modules/tsdown/dist/run.mjs
```

接入（web profile）：`$DSH_HOME/profiles/enterprise/package.json` 的
`dsh.profile.bundles` 追加 `"@my-company/sidebar-brand"`，并把本包软链进该 profile 的
`node_modules/@my-company/`，重启 web 即生效。headless profile 不加载 UI，无需挂载。

## 验证

web 起在 3080、拿到登录 cookie 后：

1. 模块图在册：`curl -N -H "Cookie: dsh-auth-..." http://127.0.0.1:3080/plugins/events`
   的 `graph.entries` 里含 `{"id":"@my-company/sidebar-brand","url":"/plugins/??@my-company/sidebar-brand/client.js&rev=..."}`
   （与 `@my-company/biz-plugins-panel` 并列，共 48 项）。
2. 字节级下发确认：按图中 `url` 拉取，内容为
   `window.__ModuleLoader__.load({ id: "@my-company/sidebar-brand", factory: ... })`，
   含 `sidebar.brand.mark` ×3、`sidebar.brand.name` ×2、`智能体中台`、`ENTERPRISE AI PLATFORM`。
3. 浏览器打开 `http://127.0.0.1:3080`，侧边栏左上角应显示「智」方块 + 智能体中台
   ENTERPRISE AI PLATFORM，替代默认 FishLogo。
