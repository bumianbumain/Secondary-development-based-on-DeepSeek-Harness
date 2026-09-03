#!/usr/bin/env bash
# 常态化启动 dsh enterprise web —— 订单数据走真实 SQL Server
# 用法: bash enterprise/start-web-sql.sh
# 日志: 仓库根 dsh-web-sql.log
#
# 与 start-web.sh 的区别：注入 ORDER_DATASOURCE / ORDER_DB_MSSQL / ORDER_TENANT，
# 使 biz-order 的工具从 SQL Server 读数据（业务工具代码零改动）。
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
NODE_BIN="/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-2/node.exe"
DSH_HOME="${DSH_HOME:-C:/Users/Administrator/.dsh}"

# —— 数据源配置（按需修改这几行）——
export ORDER_DATASOURCE=mssql
# 连接串：指向本机 SQL Server 2025 Express 的 DSH 库
export ORDER_DB_MSSQL="${ORDER_DB_MSSQL:-Server=localhost,1433;Database=DSH;User Id=sa;Password=DsH@Verify2026;TrustServerCertificate=true;Encrypt=true;}"
# 演示模式：把所有会话固定到 demo 租户，便于在 UI 里看到种子数据。
# 做真正的多租户隔离演示时，注释掉这一行（租户将按 session id 隔离）。
export ORDER_TENANT="${ORDER_TENANT:-demo}"

# —— biz-user 也切到真实 SQL Server（与 biz-order 同一套扩展点模式）——
export USER_DATASOURCE=mssql
export USER_DB_MSSQL="${USER_DB_MSSQL:-$ORDER_DB_MSSQL}"
export USER_TENANT="${USER_TENANT:-demo}"

# —— biz-knowledge 也切到真实 SQL Server（同一套扩展点模式）——
export KNOWLEDGE_DATASOURCE=mssql
export KNOWLEDGE_DB_MSSQL="${KNOWLEDGE_DB_MSSQL:-$ORDER_DB_MSSQL}"
export KNOWLEDGE_TENANT="${KNOWLEDGE_TENANT:-demo}"

# —— biz-invoice 也切到真实 SQL Server（同一套扩展点模式）——
export INVOICE_DATASOURCE=mssql
export INVOICE_DB_MSSQL="${INVOICE_DB_MSSQL:-$ORDER_DB_MSSQL}"
export INVOICE_TENANT="${INVOICE_TENANT:-demo}"

# —— biz-inventory 也切到真实 SQL Server（同一套扩展点模式）——
export INVENTORY_DATASOURCE=mssql
export INVENTORY_DB_MSSQL="${INVENTORY_DB_MSSQL:-$ORDER_DB_MSSQL}"
export INVENTORY_TENANT="${INVENTORY_TENANT:-demo}"

# 清理可能存在的孤儿锁，避免启动卡在 writer lock
rm -f "$DSH_HOME/.credentials.yaml.lock" 2>/dev/null || true

# 若已有实例在跑，先停掉以释放 3080
pkill -f "apps/cli/src/bin.ts" 2>/dev/null || true
sleep 1

LOG="$REPO/dsh-web-sql.log"
nohup "$NODE_BIN" --import tsx/esm apps/cli/src/bin.ts --profile enterprise --no-open > "$LOG" 2>&1 &
echo "dsh web (SQL 数据源) 已在后台启动 (pid $!), 日志: $LOG"
echo "数据源: $ORDER_DATASOURCE  租户: $ORDER_TENANT"
echo "启动完成后访问地址见日志："
echo "  grep -oE 'http://127.0.0.1:3080/\?token=[A-Za-z0-9_-]+' \"$LOG\""
