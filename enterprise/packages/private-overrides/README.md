# private-overrides/ — 第3层：核心行为覆盖

在此放「替换/拦截核心行为」的包。样板已实现：

- `system-prompt-hook/`：系统提示词覆盖 Hook——注入 `enterprise:policy` 覆盖段
  （独立槽位，不占用 `deployment:persona`），并在 `system-prompt/assemble` waterfall
  链尾兜底，保证企业行为规则（多租户隔离 + 强制工具优先）永远在场。见其包内 README。

后续可扩展（同层骨架）：

- `agent-loop-override/`：实现 `AgentFactory` 接口替换 agent loop（尚未实现）

每个包同样是声明了 `dsh.bundle` 的普通包，通过自带 `cordis.patch.yml` 的 `- insert:` 接入；
部署方调参走部署 overlay（`enterprise/profiles/*.cordis.yml`）的 `- id:` + `config`。
