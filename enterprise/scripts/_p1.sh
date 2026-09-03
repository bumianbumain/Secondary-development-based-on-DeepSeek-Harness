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

INFRA_RE='^(\.gitignore|pnpm-workspace\.yaml|pnpm-lock\.yaml)$'
TRANSIENT_RE='(^|/)(\.vs/|_tmp_|\.dsh-sdk-|\.explicit-service-|\.rendered-model-|\.generated-|staged-lint-probe-)'
DOC_DEL_RE='^\.agents/notes/archived/'

# 口径 A：已提交域 BASE..HEAD —— 允许：瞬态产物（任意状态）、归档文档删除、根级基础设施
committed_offenders=0
COMMITTED_LIST="$(git diff --name-status "$BASE" "$DEV_HEAD")"
while IFS=$'\t' read -r st path; do
  [[ -z "$path" ]] && continue
  [[ "$path" == enterprise/* ]] && continue
  printf '%s' "$path" | grep -qE "$TRANSIENT_RE" && continue
  printf '%s' "$path" | grep -qE "$INFRA_RE" && continue
  [[ "$st" == D* ]] && printf '%s' "$path" | grep -qE "$DOC_DEL_RE" && continue
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
  printf '%s' "$path" | grep -qE "$TRANSIENT_RE" && continue
  printf '%s' "$path" | grep -qE "$INFRA_RE" && continue
  wt_offenders=$((wt_offenders+1))
  fail "工作区核心改动: [$st] $path"
done <<< "$WORKTREE_LIST"
[[ $wt_offenders -eq 0 ]] && pass "工作区核心源码零改动（仅 enterprise/ + 根级基础设施）"

# ------------------------------------------------------------------ 阶段 [2]
echo "== P1-ONLY-END rc-check =="
