# private-overrides/ — 第3层：核心行为覆盖

在此放「替换/拦截核心行为」的包，例如：
- `agent-loop-override/`：实现 `AgentFactory` 接口替换 agent loop
- `system-prompt-hook/`：用 `ctx.before` 钩子拦截并改写系统提示词、强制工具调用

每个包同样是声明了 `dsh.bundle` 的普通包，通过 `--patch` 的 `- insert:` 接入。
