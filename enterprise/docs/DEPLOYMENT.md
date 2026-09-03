# enterprise/ 部署文档（P4）

> 覆盖：多环境矩阵、启动/停止、反向代理与 TLS、数据库初始化、升级 Runbook、回滚、凭据管理。
> 关联：`../env/README.md`（环境层设计）、`UPGRADE-RUNBOOK.md`（1 天升级适配）、`../tests/run-integration.sh`（验收门禁）。

## 1. 环境矩阵

| 环境 | overlay | webserver 端口 | hook debug | 数据库（SQL Server） | 数据源 env |
|---|---|---|---|---|---|
| dev | `env/dev.cordis.yml` | 3080 | true | `DSH` | `env/dev.env` |
| staging | `env/staging.cordis.yml` | 3081 | true | `DSH_Staging` | `env/staging.env` |
| prod | `env/prod.cordis.yml` | 3082 | false | `DSH_Prod` | `env/prod.env` |

公共 persona（系统提示词企业身份叙事）由 `env/common.cordis.yml` 注入，三层共享；
三层差异仅限 `port` / `debug` / 数据库名 —— 这正是“多环境配置隔离”的验收断言
（`run-integration.sh [1]` 组逐条 grep 校验）。

加载顺序（后加载覆盖先加载）：Bundle 级 `cordis.patch.yml` → profile 级 patch →
`--patch` 命令行 overlay（按参数顺序，可重复）。`--dump-config` 可预览合并后整树而不启动。

## 2. 启动 / 停止

```bash
# 前台（Ctrl-C 退出）
bash enterprise/run-web-env.sh dev
# 后台 + 落盘日志 dsh-web-<env>.log（首次启动后从日志取登录 URL）
bash enterprise/run-web-env.sh dev --bg
# 只预览配置树（不起服务）——升级/排障第一动作
bash enterprise/run-web-env.sh dev --dump | grep -E 'port:|debug:'
```

登录：浏览器打开日志中的 `http://127.0.0.1:<port>/?token=...` 一次，换取
`dsh-auth-*` HttpOnly Cookie（SameSite=Strict），后续访问自动带上。

停止后台实例：按 `dsh-web-<env>.log` 前的 PID 停止
（Windows：`taskkill //PID <pid> //F`；Git Bash：`kill <pid>`）。

## 3. 反向代理与 TLS（prod）

默认监听 `127.0.0.1`（`prod.cordis.yml` 有注释说明）。对外暴露建议前置 Nginx/Caddy：

```nginx
# Nginx 示例：终止 TLS 后反代到本机 3082
server {
  listen 443 ssl;
  server_name dsh.example.com;
  ssl_certificate     /etc/ssl/dsh/fullchain.pem;
  ssl_certificate_key /etc/ssl/dsh/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:3082;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # SSE /plugins/events 需长连接
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}
```

注意：SSE（`/plugins/events`）与 WebSocket 依赖长连接，反代必须放行
`Upgrade`/`Connection` 头并调大 `proxy_read_timeout`，否则前端模块图/热更失效。

## 4. 数据库初始化（幂等，无手工 DDL）

五个 biz Bundle 的 SQL Server 数据源均在**首次连接**时 `ensureSchema()`：
建表（若不存在）+ demo 种子（仅当 demo 租户为空表时播种，绝不覆盖既有数据）。
因此部署顺序是：建库（连接串里指定）→ 启动 → 表与种子自动就绪。

```sql
-- 一次性：创建三个环境的库（Windows 本机 SQL Server 示例）
CREATE DATABASE DSH;          -- dev
CREATE DATABASE DSH_Staging;  -- staging
CREATE DATABASE DSH_Prod;     -- prod
```

业务表清单（各 Bundle 首次连接自建，前缀 `dbo.biz_`）：
`biz_users`、`biz_orders`/`biz_order_items`、`biz_knowledge`、`biz_invoices`、
`biz_inventory`（表名以各 Bundle `ensureSchema` 为准，可用
`enterprise/tests/run-integration.sh` 的 [3] 组做存在性断言）。

验证数据是否落库：`enterprise/README.md`“数据库看板”一节（dsh web dashboard，端口 3099）。

## 5. 升级（官方新版本）——见 UPGRADE-RUNBOOK.md

`enterprise/docs/UPGRADE-RUNBOOK.md` 由 `enterprise/scripts/upgrade-drill.sh` 演练通过后
自动生成（2026-09-03 已全绿）。一句话流程：
`git fetch 官方 → merge-tree 冲突预演（断言无 enterprise/）→ pnpm install/build →
bash enterprise/tests/run-integration.sh 全绿 → 三环境 --bg 冒烟`。
核心源码零改动 → 上游发版永不与企业层冲突（预检双口径在每次演练中强制校验）。

## 6. 回滚

| 对象 | 回滚方式 |
|---|---|
| 版本 | `git reset --hard <上一适配提交>` + `pnpm install` + 门禁回归 |
| 配置 | `enterprise/env/*.cordis.yml / *.env` 随代码版本走，随版本回滚即可 |
| 数据 | ensureSchema 幂等：不删业务行；demo 种子只在空表补种。误操作可对单表 `DELETE FROM dbo.biz_<x> WHERE tenant<>'demo'` 后重启重建 |

## 7. 凭据管理（禁止入库）

- 连接串、密码只放 `enterprise/env/*.env`，且**该目录不入 git**（或只提交脱敏模板）；
- 运行器 `run-web-env.sh` 用 `set -a; source` 导入 —— 调用方若已 export 同名变量，
  `.env` 内的值会覆盖它，故生产密码应**删除 `.env` 对应行**，改由 supervisor/CI 注入；
- 生产强烈建议 `DSH_HOME=/etc/dsh-prod` 独立目录（独立凭据/settings/profile），
  与开发 `$DSH_HOME` 物理隔离，避免 `profiles/enterprise` 串环境。

## 8. 验收（P4 门禁）

```bash
bash enterprise/tests/run-integration.sh          # 全量：21 项断言（含 5 数据源 e2e + Web 冒烟）
bash enterprise/tests/run-integration.sh --quick  # 跳过数据源套件（配置/机制/Web，13 项）
bash enterprise/scripts/upgrade-drill.sh          # 上游同步演练：9 项断言
```

三者当前均 ALL GREEN（2026-09-03 记录）。任何部署/升级后以这三条命令作为放行依据。
