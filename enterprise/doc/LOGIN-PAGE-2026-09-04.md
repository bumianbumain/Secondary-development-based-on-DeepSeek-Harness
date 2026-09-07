# 外圈登录权限页 —— 路线 A（最小核心 seam）落地手册

> 日期：2026-09-04　范围：deepseek-harness + enterprise 企业层
> 背景：把 `dsh web` 外圈从「单用户启动令牌」升级为「账号密码登录 + 角色会话」，
> 同时保留旧令牌流与多租户企业层隔离。

## 1. 目标与架构结论

- **外圈** = web 前端层（浏览器 SPA + `/api` + SSE）。
- **硬约束**：`packages/*`、`vendor/` 原则上零改动（`upgrade-drill.sh` 预检）；
  纯 enterprise 层（Bundle/Patch/Profile）**无法**拦截核心 `BrowserAuth` 的 401 闸门，
  因为 webServer 只有命名路由 + SPA fallback，没有前置中间件钩子。
- **路线 A**：核心只开两个干净 seam，其余全部落 enterprise Bundle —— 这就是本文件方案。

### 核心 seam（3 个文件，受控例外）

| 文件 | 改动 |
|---|---|
| `packages/client/connection/src/browser-auth.ts` | `BrowserCookiePayload` 增加 `userId`/`roles`；新增 `AuthProvider`/`AuthCredentials`/`AuthSession` 类型；`login()` 验凭证铸造带角色的会话 Cookie；`sessionIdentity()` 解出会话；`signout()` 生成清 Cookie 头；**`authorizeIndex()` 未认证 + auth-login 已挂 `signinPageHtml` 时 302 → `/signin`**（无页面则回退 SPA 闸门；无 provider 保持 401 token 模型）；**provider 与页面 HTML 均在请求时从 `ctx.root` 懒读取**（enterprise 晚加载且 sibling 分支，构造期捕获不可行） |
| `packages/client/connection/src/rpc-host.ts` | `declare module '@deepseek-ai/cordis'` 增加 `ctx.authProvider?: AuthProvider` 与 `ctx.signinPageHtml?: string`；`HostConnectionService` 透传 `login()`/`sessionIdentity()`/`signout()`/`signinPage`/`isAuthenticated` |
| `packages/client/connection/src/index.ts` | 注册 `POST /login`、`GET /api/session/me`、`GET /signin`（已登录 302 `/`；下发企业登录页 HTML；未挂载 404）、`GET /logout`（清 Cookie + 302 `/signin`）；全部过 `isTrustedApiRequest` 围栏；导出 seam 公共类型 |

设计关键：enterprise 的 provider 晚于核心加载、且在 sibling 分支，构造期捕获不可行
→ `BrowserAuth` 持有 `ctx.root`，每次 `authorizeIndex`/`login` 现读 `ctx.root.authProvider`。

### enterprise 层（Bundle）

| Bundle | 作用 |
|---|---|
| `biz-user`（已增强） | `authenticate(username,password)` + `setPassword()`；`dbo.biz_users` 增 `secret nvarchar(255)`（scrypt 加盐哈希）；工具 `set_user_password` |
| `auth-login`（新增） | node 半：`ctx.root.provide('authProvider', …)` 委托 `biz-user.authenticate`；client 半：登录闸门（splash → 探活 `/api/session/me` → 登录页） |

## 2. 装配步骤

```bash
# 1) 构建 auth-login（双半产物 lib/index.js + lib/client.js）
cd enterprise/packages/private-bundles/auth-login
node ../../../../node_modules/tsdown/dist/run.mjs

# 2) biz-user 产物须含 getUserDataSource 导出（已含则跳过）
node node_modules/typescript/bin/tsc -p enterprise/packages/private-bundles/biz-user/tsconfig.json
```

### 运行时接入（profile bundles 清单）

编辑运行 profile（默认 `C:/Users/Administrator/.dsh/profiles/enterprise/package.json`），
在 `dsh.profile.bundles` 追加：

```json
"@my-company/auth-login"
```

之后在有 pnpm 的环境执行 `pnpm install` 建立 workspace 软链（本机无 pnpm 时
auth-login 无法硬连线，只交付源码+产物，见仓库记忆）。

### 环境变量

复用 biz-user：`USER_DB_MSSQL`（dev.env 已 `USER_DB_MSSQL=${ORDER_DB_MSSQL}` 同库）。
auth-login 启动不强制读库（懒加载），配置缺失只影响首个登录请求。

## 3. 引导首个账号密码

1. 用 biz-user 工具建号：`create_user`（需 name + email）。
2. 用 `set_user_password` 工具写入密码（scrypt 哈希落 `secret` 列）。
3. 若沿用既有账号，直接对 `U-xxx` 调 `set_user_password` 即可。
4. 当前演示账号：`admin / 123456`（demo 租户，roles=admin；登录键 `admin` 同时命中 id 与 email 列）。

> 老库注意：`ensureSchema` 的幂等 `ALTER ADD secret` 只在新版代码首次建池时执行；
> 若 biz_users 是旧结构且从未被新版起过，先手动执行
> `IF COL_LENGTH('dbo.biz_users','secret') IS NULL ALTER TABLE dbo.biz_users ADD secret nvarchar(255) NULL`。

## 4. 登录流程（现行：服务端路由级分流）

```
GET / ──带有效会话 Cookie──→ 平台（SPA）
  │
  无会话（且 auth-login 已挂 signinPageHtml）
  ↓
302 → GET /signin（自包含登录页 HTML，不加载 SPA）
  │ 表单 fetch POST /login
  ↓ 成功
location.href = '/' → 平台
```

- `GET /signin`：已登录访问反向 302 回 `/`；auth-login 未挂载页面时 404（此时回退 SPA 闸门）。
- `GET /logout`：清会话 Cookie（Max-Age=0）+ 302 `/signin`。旧 token 铸的会话访问一次即回到登录页。
- 兼容分层：无 provider = 旧 token 模型；有 provider 无 signinPageHtml = SPA 闸门
  （client 半 LoginGate 保留作深度防御）；两者都有 = 服务端 302 登录页（现行）。
- 登录页 HTML 由 auth-login 的 `src/signin-page.ts` 生成（design.ts token 内联，无 React/SPA 依赖），
  node 半 `ctx.root.provide('signinPageHtml', …)`；核心在请求时懒读取（与 authProvider 同款模式）。

## 5. 验证路径（2026-09-04 全部通过）

1. `bash enterprise/start-web-sql.sh`（或 `.vscode` 启动配置）。
2. 浏览器打开 `http://127.0.0.1:3080/`（不带 `?token=`）→ 302 到 `/signin` 渲染登录页。
3. 错误密码 → 表单内提示；正确密码 → `POST /login` 200 + `set-cookie` → `location.href='/'` 进平台。
4. 已登录访问 `/signin` → 302 回 `/`；访问 `/logout` → 清 Cookie → 302 `/signin`。
5. `curl -i http://127.0.0.1:3080/api/session/me` 无 Cookie → 401（本机 curl 须加 `--noproxy '*'`）。
6. 旧令牌流仍可用：`dsh web` 打印的 `?token=` URL → 303 铸 Cookie（userId 空）→ 直达。
7. 真实渲染核验：Edge headless 截图
   `msedge.exe --headless=new --screenshot=signin-live.png --window-size=1440,900 http://127.0.0.1:3080/signin`。
8. 真实浏览器端到端登录（2026-09-04 通过，agent-browser + Edge）：
   `agent-browser open "http://127.0.0.1:3080/" --executable-path "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"`
   → 302 到 `/signin`；`agent-browser fill "#username" "admin"`、`fill "#password" "123456"`、
   `click "#signin-submit"` → snapshot 确认平台首页完整加载。
   注意：每个子命令都要带 `--executable-path`（daemon 不跨命令记忆该参数）；
   type/fill/click 直接用 CSS selector（`#username`/`#password`/`#signin-submit`）比 snapshot ref 更稳。

## 6. 安全边界（复用核心既有实现）

- 会话 Cookie：`HttpOnly` + `SameSite=Strict` + HMAC 签名 + Host 绑定 + 过期校验。
- `/login`、`/signin`、`/logout`、`/api/*` 都过 Host/Origin 信任围栏（`isTrustedApiRequest`，防 DNS rebinding/跨站）。
- `/login` body 上限 64KB；非 POST/非 JSON 一律 400/405。
- 关闭/移除 auth-login（或删 profile 行）即回退单用户令牌模型，行为与旧版一致。

## 7. 升级 drill 口径（受控例外）

`enterprise/scripts/upgrade-drill.sh` 预检已把上述 3 个 seam 文件列入白名单：
- 其余核心文件仍「零改动」判定（违规仍拦截）。
- seam 文件改动会被点名公示（PASS 行），不误报。
- 上游发版若与 seam 同名文件冲突，merge-tree 阶段[3]/[4] 会精确点名，
  届时按本文件第 1、2 节对照适配（接口形状稳定，冲突几乎只在上下文行）。

## 8. 已知取舍

- 服务端分流后匿名者拿不到 SPA index；client 半 LoginGate 闸门仅在网络异常探活失败等边缘场景触达。
- 登录成功 `location.href='/'` 为一次整页导航；`/logout` 无确认页，直接回登录页。
- 账号密码只在 `secret` 列存 scrypt 哈希；明文/弱口令策略交给上层（当前最少 6 位）。
- 公网商业化前仍需：TLS、/login 防爆破限速、改密后旧会话失效（Cookie 签名与 secret 列无关）、审计日志。
