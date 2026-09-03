#!/usr/bin/env bash
# 多环境 web 运行器 —— dev/staging/prod 三套配置，一份代码。
#
# 用法（在仓库根目录执行）:
#   bash enterprise/run-web-env.sh dev               # 前台启动 dev（Ctrl+C 停）
#   bash enterprise/run-web-env.sh staging --bg      # 后台启动（日志 dsh-web-staging.log）
#   bash enterprise/run-web-env.sh dev --dump        # 免启动预览组合配置树（验证层叠）
#
# 每环境的差异拆成两层（都在 enterprise/env/ 下）：
#   ① <env>.env        —— 环境变量：数据源连接串 / 租户开关（source 后导出）
#   ② <env>.cordis.yml —— 插件行调参：webserver 端口、system-prompt-hook debug …
#   公共层 common.cordis.yml 恒被加载（企业 persona 等与环境无关的覆盖）。
#
# 三环境可同时启动（dev:3080 / staging:3081 / prod:3082），互不干扰；
# 停止某实例：按端口找 pid 后 taskkill，例如
#   MSYS_NO_PATHCONV=1 taskkill /PID $(netstat -ano | grep ':3081' | grep LISTEN | awk '{print $5}') /F
#
# 生产隔离提示：可另设 DSH_HOME 指向专用目录（凭据/settings/profile 全隔离）再跑本脚本，
# 例如  DSH_HOME=/etc/dsh-prod bash enterprise/run-web-env.sh prod
set -euo pipefail

ENV_NAME="${1:-}"
MODE="${2:-fg}"
case "$ENV_NAME" in
  dev|staging|prod) ;;
  *) echo "用法: run-web-env.sh <dev|staging|prod> [--dump|--bg]" >&2; exit 2 ;;
esac

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Git Bash 的 POSIX 路径（/d/...）传给 node 会被相对解析成 D:\d\...，必须转 Windows 风格
REPO_WIN="$(cygpath -w "$REPO" 2>/dev/null || printf '%s' "$REPO")"
ENV_DIR="$REPO_WIN/enterprise/env"
NODE_BIN="${NODE_BIN:-/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-2/node.exe}"
DSH_HOME="${DSH_HOME:-C:/Users/Administrator/.dsh}"

ENV_FILE="$ENV_DIR/$ENV_NAME.env"
COMMON_OV="$ENV_DIR/common.cordis.yml"
ENV_OV="$ENV_DIR/$ENV_NAME.cordis.yml"
for f in "$ENV_FILE" "$COMMON_OV" "$ENV_OV"; do
  [[ -f "$f" ]] || { echo "缺少文件: $f" >&2; exit 2; }
done

# ① 环境变量层：source 后全部导出（数据源/租户/连接串等非启动决策变量可放 .env）
set -a; source "$ENV_FILE"; set +a
export DSH_ENV="$ENV_NAME"

cd "$REPO"

if [[ "$MODE" == "--dump" ]]; then
  echo "==== dsh enterprise [$ENV_NAME] 组合配置预览 ===="
  echo "（--dump-config 只打印 bundle 层 + 两个 overlay 组合结果中的关键行）"
  "$NODE_BIN" --import tsx/esm apps/cli/src/bin.ts --profile enterprise \
    --patch "$COMMON_OV" --patch "$ENV_OV" --dump-config \
    | grep -B1 -A6 -E '^- id: (webserver|system-prompt|system-prompt-hook)( |$)'
  exit 0
fi

LOG="$REPO/dsh-web-$ENV_NAME.log"
if [[ "$MODE" == "--bg" ]]; then
  nohup "$NODE_BIN" --import tsx/esm apps/cli/src/bin.ts --profile enterprise \
    --patch "$COMMON_OV" --patch "$ENV_OV" --no-open >"$LOG" 2>&1 &
  echo "dsh web [$ENV_NAME] 已在后台启动 (pid $!)  日志: $LOG"
  echo "访问地址: grep -oE 'http://127.0.0.1:[0-9]+/\?token=[A-Za-z0-9_-]+' \"$LOG\""
  exit 0
fi

exec "$NODE_BIN" --import tsx/esm apps/cli/src/bin.ts --profile enterprise \
  --patch "$COMMON_OV" --patch "$ENV_OV" --no-open
