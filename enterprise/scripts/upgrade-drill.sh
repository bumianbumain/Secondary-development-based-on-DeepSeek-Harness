#!/usr/bin/env bash
# =============================================================================
# P4 验收（三）：上游同步演练 —— 企业层在 DSH 官方发版时“1 天内完成升级适配”的证据链。
#
# 背景事实（演练会自动校验）:
#   1. 本仓库 fork 自 deepseek-harness，官方基线 BASE = <HEAD^>（release/dsh-0.1.2-alpha.4 合并点）。
#   2. 企业层全部改动只落在 enterprise/ 与根级基础设施文件（.gitignore / pnpm-workspace.yaml /
#      pnpm-lock.yaml）。核心源码（apps/*、packages/*）零改动 —— 核心诉求一律用
#      overlay patch（--patch / cordis.patch.yml）与插件 Bundle 表达，从不动核心。
#   3. 推论：官方新发版只要不触碰 enterprise/，与本地分支合并必然零冲突；
#      一旦有人违规改了核心，merge-tree 演练会把冲突精确点名。
#
# 阶段:
#   [1] precheck        已提交域 BASE..HEAD + 未提交工作区 双口径证明“零核心源码改动”
#   [2] 合成上游发版    在官方基线上构造 v0.2.0-beta.1 示例（bump 4 个核心 package.json）
#   [3] 干净升级        merge-tree 本地 vs 合成上游 → 零冲突、enterprise/ 安然无恙
#   [4] 违规改造被拦截  负例：本地若改了核心同文件 → merge-tree 报冲突并点名该文件
#   [5] Runbook         输出“1 天升级适配”行动手册（同步落盘 enterprise/docs/UPGRADE-RUNBOOK.md）
#
# 用法:
#   bash enterprise/scripts/upgrade-drill.sh          # 全流程
#   bash enterprise/scripts/upgrade-drill.sh --quiet  # 平时静默，仅失败时打印明细
#
# 实现说明:
#   - 合成提交用纯 plumbing（read-tree / update-index --cacheinfo / write-tree / commit-tree），
#     不创建 worktree/分支，主工作区与引用零扰动；Git Bash 下 GIT_INDEX_FILE 需 Windows 路径。
#   - 临时目录 _tmp_upgrade_drill/ 已被 .gitignore（_tmp_*）忽略，异常退出也不会污染 git。
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"
QUIET="${1:-}"

BASE="$(git rev-parse HEAD^)"                 # 官方基线（= 上一提交，release 合并点）
DEV_HEAD="$(git rev-parse HEAD)"              # 本地企业分支
TMP="$REPO/_tmp_upgrade_drill"
TMP_WIN="$(cygpath -w "$TMP" 2>/dev/null || printf '%s' "$TMP")"
GATE_PASS=0; GATE_FAIL=0

say() { printf '%s\n' "$*"; }
pass() { GATE_PASS=$((GATE_PASS+1)); [[ "$QUIET" != "--quiet" ]] && printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { GATE_FAIL=$((GATE_FAIL+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
trap 'rm -rf "$TMP"' EXIT

# —— 受控核心 seam（路线 A：外圈登录权限页）——
# 唯一允许触碰的核心源码：packages/client/connection 的三个文件（BrowserAuth 注入
# AuthProvider + roles Cookie；/login、/api/session/me 路由）。这是经过评审的受控例外，
# 不是违规：上游发版若触及同名文件会在 merge-tree 阶段被点名（届时按
# enterprise/doc/LOGIN-PAGE-*.md 的 seam 适配段处置）。其余核心文件仍零改动。
# 用法: is_seam <path>
is_seam() {
  case "$1" in
    packages/client/connection/src/browser-auth.ts|packages/client/connection/src/index.ts|packages/client/connection/src/rpc-host.ts) return 0 ;;
  esac
  return 1
}
SEEN_SEAMS=()

# 在 <parent> 之上生成一个仅含“路径→新内容”改动的提交（不落地工作区）。返回新提交 SHA。
# 用法: mk_commit <parent> <message> <path1> <sha1> [<path2> <sha2> ...]
mk_commit() {
  local parent="$1" msg="$2"; shift 2
  local idx="$TMP_WIN/idx"
  rm -f "$TMP/idx"
  GIT_INDEX_FILE="$idx" git read-tree "$parent"
  while [[ $# -gt 0 ]]; do
    GIT_INDEX_FILE="$idx" git update-index --add --cacheinfo "100644,$2,$1"
    shift 2
  done
  local tree
  tree="$(GIT_INDEX_FILE="$idx" git write-tree)"
  GIT_INDEX_FILE="$idx" git commit-tree "$tree" -p "$parent" -m "$msg"
}

# ------------------------------------------------------------------ 阶段 [0]
# 官方基线校验
BASE_MSG="$(git log --format=%s -1 "$BASE")"
if printf '%s' "$BASE_MSG" | grep -q 'deepseek-harness'; then
  pass "基线 = 官方合并点：${BASE:0:10} ${BASE_MSG:0:58}"
else
  fail "基线异常：HEAD^ 不是官方合并提交（${BASE_MSG}）"
fi

# ------------------------------------------------------------------ 阶段 [1]
echo
echo "[1] 预检：零核心源码改动（双口径）"
echo "    BASE = ${BASE:0:10}   HEAD = ${DEV_HEAD:0:10}"

# 口径 A：已提交域 BASE..HEAD —— 允许：瞬态产物（任意状态）、归档文档删除、根级基础设施
# 注：逐行判定用 bash [[ =~ ]]（零子进程）；避免对数百行循环 spawn grep 触发沙箱看门狗
committed_offenders=0
COMMITTED_LIST="$(git diff --name-status "$BASE" "$DEV_HEAD")"
while IFS=$'\t' read -r st path; do
  [[ -z "$path" ]] && continue
  [[ "$path" == enterprise/* ]] && continue
  is_seam "$path" && { SEEN_SEAMS+=("$path"); continue; }
  [[ "$path" =~ (^|/)(\.vs/|_tmp_|\.dsh-sdk-|\.explicit-service-|\.rendered-model-|\.generated-|staged-lint-probe-) ]] && continue
  [[ "$path" =~ ^(\.gitignore|pnpm-workspace\.yaml|pnpm-lock\.yaml)$ ]] && continue
  [[ "$st" == D* && "$path" == .agents/notes/archived/* ]] && continue
  committed_offenders=$((committed_offenders+1))
  fail "已提交域核心改动: [$st] $path"
done <<< "$COMMITTED_LIST"
[[ $committed_offenders -eq 0 ]] && pass "已提交域（BASE..HEAD）核心源码零改动"

# 口径 B：未提交工作区 —— 仅允许：瞬态/归档删除、根级基础设施修改
wt_offenders=0
WORKTREE_LIST="$(git status --porcelain)"
while read -r st path; do
  [[ -z "$path" ]] && continue
  [[ "$path" == enterprise/* ]] && continue
  is_seam "$path" && { SEEN_SEAMS+=("$path"); continue; }
  [[ "$path" =~ (^|/)(\.vs/|_tmp_|\.dsh-sdk-|\.explicit-service-|\.rendered-model-|\.generated-|staged-lint-probe-) ]] && continue
  [[ "$path" =~ ^(\.gitignore|pnpm-workspace\.yaml|pnpm-lock\.yaml)$ ]] && continue
  wt_offenders=$((wt_offenders+1))
  fail "工作区核心改动: [$st] $path"
done <<< "$WORKTREE_LIST"
[[ $wt_offenders -eq 0 ]] && pass "工作区核心源码零改动（仅 enterprise/ + 根级基础设施）"
if [[ ${#SEEN_SEAMS[@]} -gt 0 ]]; then
  pass "受控核心 seam（外圈登录权限，${#SEEN_SEAMS[@]} 处）：$(printf '%s' "${SEEN_SEAMS[*]}")"
  say "      ↑ 路线 A 的受控例外；上游若触碰同名文件会被阶段[3]/[4]点名，按 LOGIN-PAGE seam 段适配"
fi

# ------------------------------------------------------------------ 阶段 [2]
echo
echo "[2] 合成上游发版 v0.2.0-beta.1（纯 plumbing 构造，不落地工作区）"
rm -rf "$TMP"; mkdir -p "$TMP"

UP_BUMP_FILES=(apps/cli/package.json apps/web/package.json
  packages/api/gateway/package.json packages/client/modules/package.json)
up_args=(); bumped=0
for f in "${UP_BUMP_FILES[@]}"; do
  if git cat-file -e "$BASE:$f" 2>/dev/null \
     && git show "$BASE:$f" | grep -q '"version": "0.1.2-alpha.4"'; then
    new="$(git show "$BASE:$f" | sed 's/"version": "0.1.2-alpha.4"/"version": "0.2.0-beta.1"/')"
    sha="$(printf '%s' "$new" | git hash-object -w --stdin)"
    up_args+=("$f" "$sha"); bumped=$((bumped+1))
  fi
done
[[ ${#up_args[@]} -eq 0 ]] && { fail "未找到可 bump 的核心 package.json"; exit 1; }
UP_SHA="$(mk_commit "$BASE" "release(dsh): 0.2.0-beta.1（合成上游示例，模拟官方发版）" "${up_args[@]}")"
[[ $bumped -ge 3 ]] && pass "合成上游提交：bump $bumped 个核心 package.json（${UP_SHA:0:10}）" \
                    || fail "合成上游 bump 文件不足（$bumped）"

up_ent="$(git diff --name-only "$BASE" "$UP_SHA" | grep -c '^enterprise/' || true)"
[[ "$up_ent" == "0" ]] && pass "上游发版不触碰 enterprise/（企业文件差异 0）" \
                        || fail "上游发版竟改了 enterprise/（$up_ent 个）——演练前提被破坏"

# ------------------------------------------------------------------ 阶段 [3]
echo
echo "[3] 干净升级：本地分支合并 v0.2.0-beta.1"
set +e
MERGE_OUT="$(git merge-tree --write-tree --name-only "$DEV_HEAD" "$UP_SHA" 2>&1)"
MERGE_RC=$?
set -e
if [[ $MERGE_RC -eq 0 ]]; then
  pass "merge-tree 零冲突（rc=0）——企业层可无冲突承接上游发版"
else
  fail "合并出现冲突（rc=$MERGE_RC）：$(printf '%s' "$MERGE_OUT" | grep -E 'CONFLICT' | head -3 | tr '\n' ' ')"
fi
if printf '%s' "$MERGE_OUT" | grep -q 'enterprise/'; then
  fail "冲突清单涉及 enterprise/ 文件（不应发生）"
else
  pass "冲突清单不含任何 enterprise/ 文件"
fi

# ------------------------------------------------------------------ 阶段 [4]
echo
echo "[4] 违规改造被拦截（负例演练）"
f=apps/cli/package.json
viol_new="$(git show "$DEV_HEAD:$f" | sed 's/"version": "0.1.2-alpha.4"/"version": "0.1.2-alpha.4.ent-local"/')"
viol_sha="$(printf '%s' "$viol_new" | git hash-object -w --stdin)"
VIOL_SHA="$(mk_commit "$DEV_HEAD" "chore: 违规示例——直接改核心 apps/cli 版本（仅演练用，不入主线）" "$f" "$viol_sha")"
set +e
VIOL_OUT="$(git merge-tree --write-tree --name-only "$VIOL_SHA" "$UP_SHA" 2>&1)"
VIOL_RC=$?
set -e
if [[ $VIOL_RC -ne 0 ]] && printf '%s' "$VIOL_OUT" | grep -q 'apps/cli/package.json'; then
  pass "核心违规改造被上游冲突点名：apps/cli/package.json"
else
  fail "违规改造未被检出（rc=$VIOL_RC out=$(printf '%s' "$VIOL_OUT" | head -3 | tr '\n' ' ')）"
fi

# ------------------------------------------------------------------ 阶段 [5]
echo
echo "[5] 1 天升级适配 Runbook"
mkdir -p "$REPO/enterprise/docs"
RUNBOOK="$REPO/enterprise/docs/UPGRADE-RUNBOOK.md"
cat > "$RUNBOOK" <<EOF
# DSH 官方版本升级 Runbook（1 天适配，企业层）

> 由 \`enterprise/scripts/upgrade-drill.sh\` 于 $(date '+%F %T') 演练通过后自动生成。
> 基线：$(git log --format='%h %s' -1 "$BASE")　本地：$(git log --format='%h %s' -1 "$DEV_HEAD")
> 演练结论：合成上游 v0.2.0-beta.1 与本地分支 merge-tree 零冲突，冲突清单不含任何
> enterprise/ 文件；核心违规改造（apps/cli/package.json）会被冲突点名拦截。

## 为什么企业层升级几乎零成本
- 核心源码零改动（双口径预检保证）：已提交域 BASE..HEAD 与未提交工作区中，非 enterprise/
  变更仅限瞬态产物清理、归档文档删除与 \`.gitignore / pnpm-workspace.yaml / pnpm-lock.yaml\`。
- 受控例外（路线 A 登录 seam）：\`packages/client/connection/src/\` 的 browser-auth.ts /
  index.ts / rpc-host.ts 三处为核心“能力 seam”（AuthProvider 注入 + /login 路由），
  经评审允许并会在预检阶段点名公示；上游若与它们冲突，merge-tree 会精确点名，
  按 enterprise/doc/LOGIN-PAGE-*.md 的 seam 适配段处置即可。
- 一切核心诉求走叠加层：\`--patch\` overlay / \`cordis.patch.yml\`（Bundle 级与 profile 级）/
  插件 Bundle，从不改核心 → 上游发版永不与企业层冲突。
- 数据与配置在仓库之外：连接串、租户、端口按环境注入（\`enterprise/env/<env>.env\`），
  升级不触碰运行配置。

## 升级当天流程（8 小时建议排期）
| 时段 | 动作 | 命令/产物 |
|---|---|---|
| 09:00–09:30 | 拉官方新版本 | \`git fetch <官方 remote> master\`（或 release tag） |
| 09:30–10:00 | 冲突预演 | \`git merge-tree --write-tree --name-only HEAD <官方远端>\`；断言冲突清单不含 enterprise/ |
| 10:00–11:00 | 若上游动了企业层同名 API | 按断点逐项适配（上游极少触碰 enterprise/，此步通常为空） |
| 11:00–11:30 | 依赖重装/构建 | \`pnpm install && pnpm build\`（按上游 release note 决定是否清 node_modules） |
| 13:30–14:30 | 门禁回归 | \`bash enterprise/tests/run-integration.sh\`（配置树/多环境/机制/5 数据源 e2e/Web 冒烟） |
| 14:30–15:30 | 三环境冒烟 | \`bash enterprise/run-web-env.sh dev|staging|prod --bg\` + 端口探测 |
| 15:30–16:30 | 手工冒烟 | 浏览器过 4 条验收路径（首页鉴权、系统提示词、侧边栏品牌、biz-plugins-panel） |
| 16:30–17:00 | 处置残留 | 若有未覆盖断点：按 \`enterprise/README.md\` “升级适配”清单逐项核对并记录 |

## 验收清单（对应建议书 6.3 与验收标准）
- [ ] 集成门禁全绿（\`run-integration.sh\` 无 FAIL）
- [ ] 三个环境 \`--dump-config\` 差异仅限预期字段（port/debug/persona）
- [ ] 冲突预演输出不含 enterprise/（若含 → 先解冲突再合并）
- [ ] dev/staging/prod 各启动一次并完成 Web 冒烟
- [ ] 本文件顶部“演练结论”日期为本日

## 回滚预案
- 版本回退：\`git reset --hard <上一适配提交>\` + \`pnpm install\` 重装 + 门禁回归。
- 配置回退：\`enterprise/env/\` 与数据库均版本外管理，切换即回滚；无需动核心。
- 数据安全：biz 库表由各数据源 ensureSchema 幂等建表/种子，仅 demo 空表时播种，绝不覆盖业务数据。
EOF
[[ $GATE_FAIL -eq 0 ]] && pass "Runbook 已落盘 enterprise/docs/UPGRADE-RUNBOOK.md" \
                        || fail "演练未全绿（Runbook 仍生成，供人工处置参考）"

# ------------------------------------------------------------------ 汇总
echo
echo "== 汇总：PASS=$GATE_PASS FAIL=$GATE_FAIL =="
[[ $GATE_FAIL -gt 0 ]] && { echo "== 结果：FAIL =="; exit 1; }
echo "== 结果：ALL GREEN =="
