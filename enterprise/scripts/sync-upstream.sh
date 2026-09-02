#!/usr/bin/env bash
# 从 upstream 同步 DeepSeek Harness 最新变更到本 fork。
# 前提：fork 已配置 remote `upstream` 指向 deepseek-ai/deepseek-harness。
set -euo pipefail

cd "$(dirname "$0")/../.."   # 切到 fork 根目录 (deepseek-harness)

echo "==> 拉取 upstream/main"
git fetch upstream

echo "==> 合并到当前分支（你的 enterprise/ 是未跟踪内容，会自动保留）"
git merge upstream/main --no-edit

echo "==> 重新安装依赖"
pnpm install

echo "==> 重新构建"
pnpm run build

echo "== 同步完成。请用 dsh --profile web --dump-config 验证插件树无回归。"
