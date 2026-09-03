# 后续再加一个插件（Bundle）的开发步骤

> 本指南把 P1~P4 已验证的三类 Bundle 配方固化成「复制→改名→填充」流程，保证新插件
> 与现有 8 个包同构、同规约、同门禁，且**始终不修改 DSH 核心源码**。
> 配套实物参考：`enterprise/packages/private-{bundles,ui,overrides}/` 下每个包都有
> 完整 src + cordis.patch.yml + tools/verify-*.mjs + README，可直接对照。

## 0. 先选包位（三类模板，选一）

| 你想做什么 | 放哪 | 参考模板 |
|---|---|---|
| 给 LLM 加**业务工具 + 数据源**（查/写某业务表，多租户） | `packages/private-bundles/<name>/` | `biz-user`（契约→工厂→mssql→验证最全） |
| 改**前端 UI**（新面板/新 Tab/品牌/入口） | `packages/private-ui/<name>/` | `sidebar-brand`（slot 定制）或 `biz-plugins-panel`（面板） |
| 覆盖**行为/系统提示词/钩子** | `packages/private-overrides/<name>/` | `system-prompt-hook` |

命名：包名 `@my-company/<name>`（kebab-case），目录同名，`"private": true`。
所有包都在 `pnpm-workspace.yaml` 的 `enterprise/packages/*/*` 覆盖范围内，无需改 workspace。

## 1. 骨架（复制模板最快）

```bash
cd enterprise/packages
# 业务 Bundle：cp -r private-bundles/biz-user private-bundles/<name>
# UI 包：      cp -r private-ui/biz-plugins-panel private-ui/<name>
# 行为包：      cp -r private-overrides/system-prompt-hook private-overrides/<name>
# 然后：改 package.json name/description；删掉不用的 src/tools 按下面重写
```

`package.json` 关键字段（照抄模板，别发明新字段）：
```jsonc
"name": "@my-company/<name>",
"private": true,
"type": "module",
"main": "lib/index.js", "types": "lib/index.d.ts",
"exports": { ".": {"types":"./lib/index.d.ts","default":"./lib/index.js"},
             "./cordis.patch.yml": "./cordis.patch.yml",
             "./src/*": "./src/*", "./package.json": "./package.json" },
"files": ["lib/index.js","lib/index.d.ts","cordis.patch.yml"],
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
// UI 包追加:
"dsh": { "bundle": { "patch": "./cordis.patch.yml" },
         "client": { "inject": ["@deepseek-ai/dsh-client-ui-<渲染器/侧边栏等>"],
                     "platform": "web" } },
"scripts": { "bundle": "tsdown" }        // 仅 UI 包
// 依赖：需要哪些 @deepseek-ai/* peer/workspace 依赖，照模板同类包抄；运行时库（如 mssql）进 dependencies
```

## 2. 编写 src（业务 Bundle 五件套）

1. **`src/types.ts`** —— 业务模型 + 工具入参出参 schema（schemastery，无 `z.literal` 用
   `z.union([...] as const)`；契约方法名/字段要与工具注册一致）。
2. **`src/datasource.ts`** —— **契约接口 + 工厂**（扩展点，业务工具只依赖接口）：
   ```ts
   export function getXxxDataSource() {
     if (process.env.XXX_DATASOURCE === 'mssql') {
       const conn = process.env.XXX_DB_MSSQL
       if (!conn) throw new Error('XXX_DATASOURCE=mssql 但缺 XXX_DB_MSSQL')
       return new SqlServerXxxDataSource(conn)      // 懒单例
     }
     return new MockXxxDataSource()                  // 内存回退，演示/测试可用
   }
   ```
3. **`src/datasource.mssql.ts`** —— SQL Server 实现：首次连接 `ensureSchema()`（
   `IF OBJECT_ID(...) IS NULL CREATE TABLE ...`，demo 租户空表才补种子，**绝不覆盖数据**）；
   `roles/tags` 等数组以逗号分隔 nvarchar 存储、读出拆回；**所有 SQL 用参数化
   `.input()`**（注入防护是门禁断言）；写操作捕获 2627/2601 主键冲突转友好错误；
   自增 ID（如 `U-` 前缀）扫描全表最大 +1（id 主键**跨租户全局唯一**）。
4. **`src/index.ts`** —— 插件入口：声明 config schema + `inject` 生命周期注册业务工具。
5. **`tools/verify-<name>-e2e.mjs`** —— 用 `check(name, cond, extra)` 断言套件，末尾
   `console.log(\`结果：${pass}/${pass+fail} 通过\`); process.exit(fail?1:0)`。
   覆盖：建表种子 → 租户隔离/越权 → 过滤（role/keyword/中文/组合）→ limit → 注入防护 →
   写入链路（**用随机租户 `vt<ts36>`，绝不写 demo**）→ 非法输入 → 主键冲突。
   运行：`USER_DATASOURCE=mssql USER_DB_MSSQL="..." node tools/verify-<name>-e2e.mjs`。

## 3. 编译（dsh 运行加载 lib/*.js，不是 src/*.ts！）

```bash
cd enterprise/packages/private-bundles/<name>
node /c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-2/node.exe \
  <repo>/node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/bin/tsc -p tsconfig.json
```
- tsc 路径用 Windows 绝对路径（Git Bash `/d/...` 会被 node 误转成 `D:\d\...`）。
- UI 包用 `tsdown` 双半构建：`lib/index.js`（服务半）+ `lib/client.js`（浏览器半，含
  `window.__ModuleLoader__.load(...)` 注册），构建后按包 README 核对产物标记。
- 编译产物/软链改动**不进 git**（lib/ 已被忽略），源码才入库。

## 4. 接入 profile（web 与 headless 两套按需）

`$DSH_HOME/profiles/enterprise/package.json`（本机 `~/.dsh/profiles/enterprise/`）：
```jsonc
"dsh": { "profile": { "bundles": [ /* 已有 8 个 */, "@my-company/<name>"],
                       "patchReload": "live" } }
```
然后软链到该 profile 的 node_modules（让 node 能解析到源码目录，配合 patchReload live 热更）：
```bash
ln -s /d/DSH/deepseek-harness/enterprise/packages/<类别>/<name> \
      /c/Users/Administrator/.dsh/profiles/enterprise/node_modules/@my-company/<name>
# Windows 下 ln -s 需要管理员或开发者模式；也可用 junction（mklink /J）
```
- UI 包只挂 web profile；纯业务/行为包按需要挂 headless 或 web。
- Bundle 级 patch（`cordis.patch.yml`）随包自带，按 id 命中即注入，无需手工合并。
- 环境差异（端口/debug/persona 等）不要写进包，放 `enterprise/env/*.cordis.yml` overlay。

## 5. 挂进门禁（新插件必须进回归，否则 P4 门禁不认它）

编辑 `enterprise/tests/run-integration.sh`：
- [1] 组加一行 `dump 含 <id>`：`for b in ... <name> ...`；
- [3] 组（若带数据源）加 `run_suite "<name> e2e" "$REPO/.../<name>" "tools/verify-<name>-e2e.mjs"`；
- 数据源工厂环境变量（`XXX_DATASOURCE`/`XXX_DB_MSSQL`/`XXX_TENANT`）同步进
  `enterprise/env/*.env`（模板节）与运行器无感。
跑：`bash enterprise/tests/run-integration.sh --quick`（快）→ 全量（真 SQL Server）。

## 6. 端到端实证（照 P3/P4 的验收动作）

```bash
bash enterprise/run-web-env.sh dev --bg                     # 重启 web（新 Bundle 需重启生效）
# ① 模块图必须出现 @my-company/<name>
#    登录换 cookie 后：curl -N -H "Cookie: dsh-auth-..." http://127.0.0.1:3080/plugins/events
#    注意 --noproxy '*'（本机 http_proxy 会读坏 chunked/SSE）
# ② 业务工具在 LLM 实跑可被调用（dsh 对话里直接问"用 <name> 工具查/写…"）
# ③ 数据落库核验（biz-order/tools/db-board.mjs 看板或直接 SQL）
```

## 7. 收尾文档 + 红线复查

- 包内 `README.md`：机制/契约/环境变量/验证命令（照 biz-* 模板写）。
- **红线**（每条都有门禁或预检兜底，改了会红）：
  - 不碰 `apps/`、`packages/`（核心）任何源码 —— 要改行为用 patch/插件表达；
  - 数据源切换只走工厂 env 分支，凭据不硬编码、`.env` 不入库（`enterprise/env/.gitignore`）；
  - 验证套件写 demo 用随机租户，demo 种子纯净性由 reset-demo-fixture 维护；
  - 改完 src 必须重新编译，否则 dsh 跑的是旧 lib。
- 收尾自检：`bash enterprise/tests/run-integration.sh` + `bash enterprise/scripts/upgrade-drill.sh`
  双绿才算完成；最后按 git 卫生规则提交（只提交 enterprise/ 与根级基础设施文件）。
