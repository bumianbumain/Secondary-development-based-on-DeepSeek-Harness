#!/usr/bin/env bash
# P4 集成测试门禁 —— 单命令回归整个企业层。
#
# 用法:
#   bash enterprise/tests/run-integration.sh            # 全量（需本机 SQL Server 1433 在跑）
#   bash enterprise/tests/run-integration.sh --quick    # 跳过 5 个业务数据源套件（仅配置/机制/web）
#
# 覆盖（对照建议书 6.3 质量验收标准）:
#   [配置树]   enterprise dump-config 输出预期插件树（5 biz + system-prompt-hook + persona）
#   [多环境]   dev/staging/prod 三环境 dump 差异（webserver port / hook debug）
#   [数据源]   五个 biz Bundle 对真实 SQL Server 的 e2e 断言（dev.env 连接串）
#   [行为覆盖] system-prompt-hook verify-assemble 机制断言
#   [Web]      dev 实例（3080）client 模块图含 @my-company/*（未在跑则 SKIP）
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_BIN="${NODE_BIN:-/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-2/node.exe}"
QUICK="${1:-}"

# Git Bash → node 路径转写防护（--patch 需要 Windows 风格路径）
REPO_WIN="$(cygpath -w "$REPO" 2>/dev/null || printf '%s' "$REPO")"
ENV_DIR="$REPO_WIN/enterprise/env"
COMMON_OV="$ENV_DIR/common.cordis.yml"

PASS=0; FAIL=0; SKIP=0
declare -a RESULTS=()

# 单条门禁: describe / ok(0|1) / [detail]
gate() {
  local desc="$1" ok="$2" detail="${3:-}"
  if [[ "$ok" == "0" ]]; then PASS=$((PASS+1)); RESULTS+=("PASS  $desc"); printf '  \033[32mPASS\033[0m  %s\n' "$desc"
  else FAIL=$((FAIL+1)); RESULTS+=("FAIL  $desc ${detail}"); printf '  \033[31mFAIL\033[0m  %s  %s\n' "$desc" "$detail"; fi
}

# 跑一个 node 套件脚本并断言退出码
run_suite() {
  local name="$1" dir="$2" script="$3"
  local out
  out=$(cd "$dir" && "$NODE_BIN" "$script" 2>&1) && rc=0 || rc=$?
  local tail_line
  tail_line=$(printf '%s\n' "$out" | grep -E '结果：|通过|PASS|失败' | tail -1)
  if [[ $rc -eq 0 ]]; then
    gate "$name" 0 " → $tail_line"
  else
    gate "$name" 1 "exit=$rc → $(printf '%s\n' "$out" | tail -3 | tr '\n' ' ')"
  fi
}

cd "$REPO"
echo "== P4 集成门禁 @ $(date '+%F %T') =="
echo "repo: $REPO"
echo

# ---------- 0. 环境变量（dev 数据源） ----------
# shellcheck disable=SC1091
set -a; source "$ENV_DIR/dev.env"; set +a
export DSH_ENV=dev

# ---------- 1. 配置树（enterprise dev dump 含 patch 层） ----------
echo "[1] 配置树 / 多环境（--dump-config）"
DEV_DUMP=$("$NODE_BIN" --import tsx/esm apps/cli/src/bin.ts --profile enterprise \
  --patch "$COMMON_OV" --patch "$ENV_DIR/dev.cordis.yml" --dump-config 2>&1) || true
PROD_DUMP=$("$NODE_BIN" --import tsx/esm apps/cli/src/bin.ts --profile enterprise \
  --patch "$COMMON_OV" --patch "$ENV_DIR/prod.cordis.yml" --dump-config 2>&1) || true

for b in biz-order biz-user biz-knowledge biz-invoice biz-inventory; do
  printf '%s' "$DEV_DUMP" | grep -q -- "- id: $b" && gate "dump 含 $b" 0 || gate "dump 含 $b" 1
done
printf '%s' "$DEV_DUMP" | grep -q -- "- id: system-prompt-hook" && gate "dump 含 system-prompt-hook" 0 || gate "dump 含 system-prompt-hook" 1
printf '%s' "$DEV_DUMP" | grep -q '你是企业 AI 助手' && gate "persona 由 common 层注入" 0 || gate "persona 由 common 层注入" 1
printf '%s' "$DEV_DUMP" | grep -qE 'port: 3080' && gate "dev webserver 端口 3080" 0 || gate "dev webserver 端口 3080" 1
printf '%s' "$PROD_DUMP" | grep -qE 'port: 3082' && gate "prod webserver 端口 3082" 0 || gate "prod webserver 端口 3082" 1
printf '%s' "$DEV_DUMP" | grep -qE 'debug: true' && gate "dev hook debug=true" 0 || gate "dev hook debug=true" 1
printf '%s' "$PROD_DUMP" | grep -qE 'debug: false' && gate "prod hook debug=false" 0 || gate "prod hook debug=false" 1

# ---------- 2. 行为覆盖机制（不起 LLM） ----------
if [[ "$QUICK" != "--quick" ]]; then
  echo
  echo "[2] system-prompt-hook 机制断言"
  run_suite "system-prompt-hook verify-assemble" \
    "$REPO/enterprise/packages/private-overrides/system-prompt-hook" "tools/verify-assemble.mjs"
fi

# ---------- 3. 五个业务 Bundle 数据源 e2e（真实 SQL Server） ----------
if [[ "$QUICK" == "--quick" ]]; then
  echo
  echo "[3] --quick: 跳过业务数据源套件"
else
  echo
  echo "[3] 业务数据源 e2e（SQL Server, dev.env 连接串）"
  run_suite "biz-order datasource"  "$REPO/enterprise/packages/private-bundles/biz-order"     "tools/probe-e2e.mjs"
  run_suite "biz-order write"       "$REPO/enterprise/packages/private-bundles/biz-order"     "tools/verify-write.mjs"
  # demo 夹具复位：清除 LLM 实跑/历史手动运行在 demo 租户留下的残留，保证纯净性断言可复现
  # （脚本放 biz-user/tools 下是为了与套件共享 mssql 的 pnpm 依赖解析路径）
  if out=$(cd "$REPO" && "$NODE_BIN" "$REPO_WIN/enterprise/packages/private-bundles/biz-user/tools/reset-demo-fixture.mjs" 2>&1); then
    gate "biz-user demo 夹具复位" 0 " → $(printf '%s' "$out" | tail -1)"
  else
    gate "biz-user demo 夹具复位" 1 " → $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
  fi
  run_suite "biz-user e2e"          "$REPO/enterprise/packages/private-bundles/biz-user"      "tools/verify-user-e2e.mjs"
  run_suite "biz-knowledge e2e"     "$REPO/enterprise/packages/private-bundles/biz-knowledge" "tools/verify-knowledge-e2e.mjs"
  run_suite "biz-invoice e2e"       "$REPO/enterprise/packages/private-bundles/biz-invoice"   "tools/verify-invoice-e2e.mjs"
  run_suite "biz-inventory e2e"     "$REPO/enterprise/packages/private-bundles/biz-inventory" "tools/verify-inventory-e2e.mjs"
fi

# ---------- 4. Web 冒烟（dev 实例在跑时） ----------
echo
echo "[4] Web 冒烟（3080）"
if netstat -ano 2>/dev/null | grep -q ':3080.*LISTEN'; then
  LOG="$REPO/dsh-web-dev.log"
  # 注: 原生 curl.exe 在 Git Bash 下 -o /dev/null 会写失败(rc=23), 且 SSE 常驻流会 -m 超时(rc=28);
  # 因此一律捕获到变量并 `|| true` 屏蔽退出码, 靠后续 grep 断言数据。
  TOKEN=$(grep -oE 'http://127.0.0.1:3080/\?token=[A-Za-z0-9_-]+' "$LOG" 2>/dev/null | tail -1 | sed 's|.*token=||') || true
  if [[ -n "$TOKEN" ]]; then
    HDRS=$(curl -s --noproxy '*' -D - -m 6 "http://127.0.0.1:3080/?token=$TOKEN" 2>/dev/null) || true
    COOKIE=$(printf '%s' "$HDRS" | grep -i '^set-cookie:' | sed -E 's/^[Ss]et-[Cc]ookie: ([^;=]+=[^;]+).*/\1/' | head -1)
    if [[ -n "$COOKIE" ]]; then
      GRAPH=$(curl -s --noproxy '*' -N -m 8 -H "Cookie: $COOKIE" "http://127.0.0.1:3080/plugins/events" 2>/dev/null) || true
      printf '%s' "$GRAPH" | grep -q '@my-company/sidebar-brand' && gate "模块图含 sidebar-brand" 0 || gate "模块图含 sidebar-brand" 1
      printf '%s' "$GRAPH" | grep -q '@my-company/biz-plugins-panel' && gate "模块图含 biz-plugins-panel" 0 || gate "模块图含 biz-plugins-panel" 1
    else
      gate "web 鉴权 cookie" 1 "token 换取失败"
    fi
  else
    gate "web token" 1 "dsh-web-dev.log 无 URL"
  fi
else
  SKIP=$((SKIP+1)); RESULTS+=("SKIP  web（dev 3080 未在跑）"); printf '  \033[33mSKIP\033[0m  web（dev 3080 未在跑）\n'
fi

# ---------- 汇总 ----------
echo
echo "== 汇总：PASS=$PASS FAIL=$FAIL SKIP=$SKIP =="
printf '  %s\n' "${RESULTS[@]}"
if [[ $FAIL -gt 0 ]]; then
  echo "== 结果：FAIL =="
  exit 1
fi
echo "== 结果：ALL GREEN =="
