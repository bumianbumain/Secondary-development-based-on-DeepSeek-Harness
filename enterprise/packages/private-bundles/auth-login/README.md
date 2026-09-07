# @my-company/auth-login —— 外圈登录权限 Bundle

让 DSH web（外圈）从「单用户启动令牌」升级为「账号密码登录 + 角色会话」的最小落地层。

## 组成

| 半        | 产物              | 职责                                                                                                                                                 |
| -------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| node 半   | `lib/index.js`  | `apply()` 把 `AuthProvider` `provide` 到 `ctx.root`；凭证校验委托 `@my-company/biz-user` 的 `getUserDataSource().authenticate()`（SQL Server 用户表，scrypt 加盐哈希） |
| client 半 | `lib/client.js` | 浏览器登录闸门：启动 splash → 探活 `GET /api/session/me` → 未登录铺登录页；`POST /login` 成功后整页刷新                                                                       |

## 设计稿对照

登录页严格按设计稿（fileId `722145033479525`，「云屿·协作平台」1440×900）像素级还原：

- 左面板（50%）：渐变深蓝底（135deg, `#24478C` → `#0D2152`）+ 蓝紫/青绿双径向光晕 + 24px 点阵纹理（白 7%）+ 品牌 LOGO + 双行 44px Bold 主标题 + 玻璃评价卡（`backdrop-blur 20px`，白 8% 填充 + 18% 描边）。
- 右面板（50%）：暖白 `#FAFAF8` 底 + 右上蓝雾 + 左下暖雾 + 居中 400px 表单列（标题、聚焦态邮箱输入、默认态密码输入、记住我+忘记密码、胶囊深蓝主按钮、分割线+微信/短信/飞书、注册引导、页脚）。
- 响应式：≥ 1024px 双栏；< 1024px 隐藏左面板。

**设计 token 全部集中在 [`src/client/design.ts`](./src/client/design.ts)**，便于后续接 enterprise profile 时按公司换肤（品牌名、文案、Logo 颜色等）。

### 静态预

打开 [`preview.html`](./preview.html) 即可在浏览器中直接看到设计稿静态效果（无后端依赖，提交按钮会提示「未连接后端」）。

颜色精确取值来自对设计稿 PNG 的实际像素分析（`Pillow` 采样），确认渐变方向为 135°（左上浅 → 右下深）。

依赖的核心 seam（`packages/client/connection`）：

- `BrowserAuth` 支持可选 `AuthProvider`；有 provider 时未认证的 index 放行 SPA（登录页可渲染），`/api/*` 仍强制会话。
- 新增 `POST /login`（验凭证 + 下发 HttpOnly/Strict 会话 Cookie）与 `GET /api/session/me`。
- provider 在**请求时**从 `ctx.root` 懒读取（本 Bundle 晚于核心加载、且在 sibling 分支，构造时捕获不可行）。

## 装配

1. 构建本 Bundle（双半）：
   ```bash
   cd enterprise/packages/private-bundles/auth-login
   node ../../../../node_modules/tsdown/dist/run.mjs   # 产出 lib/index.js + lib/client.js
   ```
2. 确认 biz-user 已构建（含 `getUserDataSource` 导出）。
3. 在运行 profile 的 bundles 列表追加一行（`C:/Users/Administrator/.dsh/profiles/enterprise/package.json`）：
   ```json
   "@my-company/auth-login",
   ```
4. 环境变量：复用 biz-user 的 `USER_DB_MSSQL`（或 `USER_DB_MSSQL=${ORDER_DB_MSSQL}` 同库）。启动时未配置不崩，首个登录请求报错提示。

## 引导首个账号密码

user 表需有 `active` 用户且 `secret` 列已写入 scrypt 哈希。在 dsh 会话里调用 `biz-user` 工具：

```
给 admin 设置登录密码 123
```

底层调用 `set_user_password(tenant, userId='admin', password='123')`，
会 `UPDATE dbo.biz_users SET secret='scrypt$<salt>$<hash>' WHERE id='admin'`。

> ⚠️ admin/123 仅供本地测试。生产请用 `set_user_password` 给真实账号生成强密码哈希。

## 运行时装配

profile bundles 已在 `C:/Users/Administrator/.dsh/profiles/enterprise/package.json` 追加：

```json
"bundles": [
  ...,
  "@my-company/system-prompt-hook",
  "@my-company/auth-login"
]
```

启动顺序：`dsh-base → dsh-web-app → biz-order → biz-user → ... → auth-login`（auth-login 必须在 biz-user 之后挂载，因为 `ctx.root.provide('authProvider')` 要从已经激活的 biz-user 数据源里取 `getUserDataSource`）。

环境变量：复用 biz-user 的 `USER_DB_MSSQL`（或 `USER_DB_MSSQL=${ORDER_DB_MSSQL}` 同库）。启动时未配置不崩，首个登录请求报错提示。

## 验证

1. 未登录打开根路径 → 出现登录页（`dsh web` 启动 URL 若带 `?token=`，仍会走旧令牌流直达，属预期）。
2. 输入 `admin` / `123` → 整页刷新进入应用；错误密码 → 表单内提示「用户名或密码错误」。
3. `curl -i` 检查：未带 Cookie 访问 `/api/session/me` 返回 401；`POST /login` 成功返回 `set-cookie`。

## 安全边界

- 会话 Cookie：HttpOnly + SameSite=Strict + HMAC 签名 + Host 绑定（核心 BrowserAuth 实现）。
- `/login` 与 `/api/*` 均过 Host/Origin 信任围栏（防 DNS rebinding/跨站）。
- 登录 UI 只是体验层；越权防护完全在服务端，关掉本 Bundle 即回退单用户令牌模型。
