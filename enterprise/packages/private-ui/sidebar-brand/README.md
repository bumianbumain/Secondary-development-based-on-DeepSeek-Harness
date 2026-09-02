# private-ui/ — 第4层：UI 定制

通过 `ctx.slot` 注入 React 组件做品牌定制：
- `sidebar-brand/`：企业 Logo / 侧边栏品牌组件
- `workspace-templates/`：预置工作区模板

Web UI 由 `packages/bundle/web-app` 提供，定制走 slot 注入，不修改 upstream 前端源码。
