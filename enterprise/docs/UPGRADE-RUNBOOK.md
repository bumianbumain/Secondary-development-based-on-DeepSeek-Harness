# DSH 官方版本升级 Runbook（1 天适配，企业层）

> 由 `enterprise/scripts/upgrade-drill.sh` 于 2026-09-03 15:41:46 演练通过后自动生成。
> 基线：4e84901e64 Merge pull request #3427 from deepseek-harness/release/dsh-0.1.2-alpha.4　本地：cc2c9fc7da 二次开发: 清理文档 + 新增企业模块
> 演练结论：合成上游 v0.2.0-beta.1 与本地分支 merge-tree 零冲突，冲突清单不含任何
> enterprise/ 文件；核心违规改造（apps/cli/package.json）会被冲突点名拦截。

## 为什么企业层升级几乎零成本
- 核心源码零改动（双口径预检保证）：已提交域 BASE..HEAD 与未提交工作区中，非 enterprise/
  变更仅限瞬态产物清理、归档文档删除与 `.gitignore / pnpm-workspace.yaml / pnpm-lock.yaml`。
- 一切核心诉求走叠加层：`--patch` overlay / `cordis.patch.yml`（Bundle 级与 profile 级）/
  插件 Bundle，从不改核心 → 上游发版永不与企业层冲突。
- 数据与配置在仓库之外：连接串、租户、端口按环境注入（`enterprise/env/<env>.env`），
  升级不触碰运行配置。

## 升级当天流程（8 小时建议排期）
| 时段 | 动作 | 命令/产物 |
|---|---|---|
| 09:00–09:30 | 拉官方新版本 | `git fetch <官方 remote> master`（或 release tag） |
| 09:30–10:00 | 冲突预演 | `git merge-tree --write-tree --name-only HEAD <官方远端>`；断言冲突清单不含 enterprise/ |
| 10:00–11:00 | 若上游动了企业层同名 API | 按断点逐项适配（上游极少触碰 enterprise/，此步通常为空） |
| 11:00–11:30 | 依赖重装/构建 | `pnpm install && pnpm build`（按上游 release note 决定是否清 node_modules） |
| 13:30–14:30 | 门禁回归 | `bash enterprise/tests/run-integration.sh`（配置树/多环境/机制/5 数据源 e2e/Web 冒烟） |
| 14:30–15:30 | 三环境冒烟 | `bash enterprise/run-web-env.sh dev|staging|prod --bg` + 端口探测 |
| 15:30–16:30 | 手工冒烟 | 浏览器过 4 条验收路径（首页鉴权、系统提示词、侧边栏品牌、biz-plugins-panel） |
| 16:30–17:00 | 处置残留 | 若有未覆盖断点：按 `enterprise/README.md` “升级适配”清单逐项核对并记录 |

## 验收清单（对应建议书 6.3 与验收标准）
- [ ] 集成门禁全绿（`run-integration.sh` 无 FAIL）
- [ ] 三个环境 `--dump-config` 差异仅限预期字段（port/debug/persona）
- [ ] 冲突预演输出不含 enterprise/（若含 → 先解冲突再合并）
- [ ] dev/staging/prod 各启动一次并完成 Web 冒烟
- [ ] 本文件顶部“演练结论”日期为本日

## 回滚预案
- 版本回退：`git reset --hard <上一适配提交>` + `pnpm install` 重装 + 门禁回归。
- 配置回退：`enterprise/env/` 与数据库均版本外管理，切换即回滚；无需动核心。
- 数据安全：biz 库表由各数据源 ensureSchema 幂等建表/种子，仅 demo 空表时播种，绝不覆盖业务数据。
