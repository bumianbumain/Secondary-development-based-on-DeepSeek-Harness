#!/usr/bin/env bash
# 启动 DSH 数据库只读看板（浏览器查看 SQL Server 数据）
#
#   bash enterprise/start-db-board.sh
#
# 默认访问 http://127.0.0.1:3099 ，可用 PORT=xxxx 改端口。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-2/node.exe}"
PKG_DIR="$REPO_ROOT/enterprise/packages/private-bundles/biz-order"

export PORT="${PORT:-3099}"
export ORDER_DB_MSSQL="${ORDER_DB_MSSQL:-Server=localhost,1433;Database=DSH;User Id=sa;Password=DsH@Verify2026;TrustServerCertificate=true;Encrypt=true;}"

cd "$PKG_DIR"
echo "看板启动中 → http://127.0.0.1:$PORT  (Ctrl+C 停止)"
exec "$NODE_BIN" tools/db-board.mjs
