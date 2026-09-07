#!/usr/bin/env bash
# 常态化启动 dsh enterprise web —— 订单数据走真实 SQL Server (端口 3080)
#
# 两种用法：
#   手动常驻  : bash enterprise/start-web-sql.sh          # nohup 后台，退出终端仍运行
#   任务计划程序: bash enterprise/start-web-sql.sh --fg   # 前台，作为计划任务主进程常驻
#
# 幂等：若 3080 已在监听则直接跳过（保留已有会话 / token / 浏览器 cookie），
#       避免重复启动把进程级随机 token 冲掉。
# 启动后把可访问 URL 落盘到仓库根 web-url.txt 与 web.url（双击即开，cookie
# 失效时一次性取用；平时直接开 http://127.0.0.1:3080/ 即可，cookie 已持久）。
set -u
MODE="${1:-bg}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
NODE_BIN="/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-2/node.exe"
DSH_HOME="${DSH_HOME:-C:/Users/Administrator/.dsh}"
PORT=3080

# 开发/演示环境标识：允许下方 ORDER_TENANT 等演示变量固定租户。
# 若不加，resolveTenant 检测到演示变量却非 development 环境会硬失败（防生产跨租户泄露）。
export NODE_ENV="${NODE_ENV:-development}"

# —— 数据源配置（按需修改连接串；数据一律来自 SQL Server，无内置假数据）——
export ORDER_DB_MSSQL="${ORDER_DB_MSSQL:-Server=localhost,1433;Database=DSH;User Id=sa;Password=DsH@Verify2026;TrustServerCertificate=true;Encrypt=true;}"
export ORDER_TENANT="${ORDER_TENANT:-demo}"
export USER_DB_MSSQL="${USER_DB_MSSQL:-$ORDER_DB_MSSQL}"
export USER_TENANT="${USER_TENANT:-demo}"
export KNOWLEDGE_DB_MSSQL="${KNOWLEDGE_DB_MSSQL:-$ORDER_DB_MSSQL}"
export KNOWLEDGE_TENANT="${KNOWLEDGE_TENANT:-demo}"
export INVOICE_DB_MSSQL="${INVOICE_DB_MSSQL:-$ORDER_DB_MSSQL}"
export INVOICE_TENANT="${INVOICE_TENANT:-demo}"
export INVENTORY_DB_MSSQL="${INVENTORY_DB_MSSQL:-$ORDER_DB_MSSQL}"
export INVENTORY_TENANT="${INVENTORY_TENANT:-demo}"
export TICKET_DB_MSSQL="${TICKET_DB_MSSQL:-$ORDER_DB_MSSQL}"
export TICKET_TENANT="${TICKET_TENANT:-demo}"

# 幂等：已在监听则跳过（不重启、不重置 token/cookie）
if netstat -ano 2>/dev/null | grep -qE ":$PORT .*LISTEN"; then
  echo "dsh web 已在 $PORT 监听，跳过启动（保留现有实例）"
  exit 0
fi

rm -f "$DSH_HOME/.credentials.yaml.lock" 2>/dev/null || true
pkill -f "apps/cli/src/bin.ts" 2>/dev/null || true
sleep 1

LOG="$REPO/dsh-web-sql.log"
: > "$LOG"

if [[ "$MODE" == "--fg" ]]; then
  # 前台运行：作为任务计划程序主进程，登录期间常驻
  exec "$NODE_BIN" --import tsx/esm apps/cli/src/bin.ts --profile enterprise --no-open
fi

# 后台常驻（手动模式）
nohup "$NODE_BIN" --import tsx/esm apps/cli/src/bin.ts --profile enterprise --no-open > "$LOG" 2>&1 &
echo "dsh web (SQL 数据源) 已在后台启动 (pid $!), 日志: $LOG"

# 等 token 写入日志，再落盘固定访问文件
TOKEN=""
for i in $(seq 1 30); do
  TOKEN="$(grep -oE 'token=[A-Za-z0-9_-]+' "$LOG" | head -1 | sed 's/token=//')"
  [ -n "$TOKEN" ] && break
  sleep 1
done
if [ -n "$TOKEN" ]; then
  URL="http://127.0.0.1:$PORT/?token=$TOKEN"
  printf '%s\n' "$URL" > "$REPO/web-url.txt"
  printf '[InternetShortcut]\r\nURL=%s\r\n' "$URL" > "$REPO/web.url"
  echo "访问地址已写入 web-url.txt / web.url"
  echo "  $URL"
else
  echo "未检测到 token，稍后查看日志: grep -oE 'http://127.0.0.1:$PORT/?token=[A-Za-z0-9_-]+' \"$LOG\""
fi
