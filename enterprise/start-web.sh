#!/usr/bin/env bash
# 常态化启动 dsh enterprise web（后台常驻，日志见仓库根 dsh-web.log）
# 用法: bash enterprise/start-web.sh
# 适用: 脱离本 agent、在本地终端里一键把 web 跑起来（nohup 脱离终端常驻）
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
NODE_BIN="/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-2/node.exe"
DSH_HOME="${DSH_HOME:-C:/Users/Administrator/.dsh}"

# 清理可能存在的孤儿锁，避免启动卡在 writer lock
rm -f "$DSH_HOME/.credentials.yaml.lock" 2>/dev/null || true

# 若已有实例在跑，先停掉以释放 3080
pkill -f "apps/cli/src/bin.ts" 2>/dev/null || true
sleep 1

LOG="$REPO/dsh-web.log"
nohup "$NODE_BIN" --import tsx/esm apps/cli/src/bin.ts --profile enterprise --no-open > "$LOG" 2>&1 &
echo "dsh web 已在后台启动 (pid $!), 日志: $LOG"
echo "启动完成后访问地址见日志："
echo "  grep -oE 'http://127.0.0.1:3080/\?token=[A-Za-z0-9_-]+' \"$LOG\""
