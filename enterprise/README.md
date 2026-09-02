# enterprise/ — 你的企业级扩展层（私有仓库骨架）

本目录是你建议书 §3.1 的落地骨架：**与 upstream fork 解耦的私有扩展层**。
它放在 fork 内只是为了方便你本地开发；正式生产时应抽成独立私有仓库（`origin`），fork 仅做同步。

```
enterprise/
├── packages/
│   ├── private-bundles/        # 第2层：业务 Bundle（工具/技能）
│   │   └── biz-order/          #   示例：订单查询 Bundle（可跑）
│   ├── private-overrides/      # 第3层：核心行为覆盖（替换 agent loop / 提示词拦截）
│   │   └── system-prompt-hook/
│   └── private-ui/             # 第4层：UI 定制（侧边栏品牌、工作区模板）
│       └── sidebar-brand/
├── profiles/                   # Profile 装配（组合上面的层）
│   └── enterprise.cordis.yml
├── patches/                    # Patch 覆盖层
│   └── base-override.cordis.yml
├── configs/                    # 环境配置（dev/staging/prod）
│   └── dev/models.yml
└── scripts/
    └── sync-upstream.sh        # 上游同步脚本
```

## 接入 fork 的两种方式

**方式 A（推荐开发期）：并入 fork 的 workspace**
在 `D:/DSH/deepseek-harness/pnpm-workspace.yaml` 的 `packages:` 下加一行：
```yaml
packages:
  # ... 原有 ...
  - enterprise/packages/*/*
```
然后 `pnpm install`，你的 `@my-company/*` 包即可被 `workspace:^` 解析。

**方式 B（生产期）：私有 npm**
把 `private-bundles/*` 发布到 Verdaccio / 阿里云 NPM，在 fork 里 `pnpm add @my-company/biz-order`。

## 运行

```sh
# 从 fork 根目录
dsh web --patch enterprise/profiles/enterprise.cordis.yml
dsh --profile web --dump-config        # 审计最终插件树
```

## 同步上游

```sh
bash enterprise/scripts/sync-upstream.sh
```

> 原则：本目录永不修改 `packages/*` 与 `vendor/`。所有定制只通过 Bundle / Patch / Profile 表达。
