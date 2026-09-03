# @my-company/system-prompt-hook — 第3层「系统提示词覆盖」样板 Bundle

> 企业级扩展四层架构中的**第 3 层：核心行为覆盖**（层说明见
> [`packages/private-overrides/README.md`](../README.md)）。

在不修改 DSH 核心源码、也不替换 deployment persona 的前提下，把「企业行为覆盖层」
注入**每次**系统提示词的组装结果。双通道实现：

1. **声明式 section 注入**：向 `systemPrompt` 注册 `enterprise:policy` 段，落位相对
   部署 persona 可调：`first` / `before-persona` / `after-persona` / `complete`
   （`complete` 表示由该段整体接管系统提示词，白标场景）。
2. **命令式 assemble 收尾钩子**：监听 `system-prompt/assemble`，在 waterfall 链尾
   `await next()` 拿到「所有上游改写完成」的权威结果后再决策——企业段不在场就放回
   （`guard`），保证企业身份与工具优先约束**永远在场**，上游作用域无法静默清掉。

## 为什么是独立槽位，而不是另一个 persona？

`deployment:persona` 槽已被 dsh-system-prompt 服务自身注册占用，同名注册会直接 throw。
企业覆盖层因此用专属段名 `enterprise:policy` + 一个收尾钩子，与 persona **解耦**：
persona 讲「身份叙事」（部署方配置），覆盖层立「行为规则」（企业强制）。

## 默认注入文案（可被 `config.text` 覆盖）

- 企业身份 + 多租户隔离：只基于工具实际返回的数据作答，不假设、不捏造、不跨租户；
- 强制工具优先：凡可由已注册业务工具查到的信息，先调用工具取得真实结果再回答。

## 插件配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `text` | 内置默认文案 | 企业覆盖段主体；支持 `{{variable}}` 插值 |
| `position` | `after-persona` | `first` / `before-persona` / `after-persona` / `complete` |
| `enforceTools` | `true` | 是否追加「先工具后回答」硬约束子句 |
| `guard` | `true` | 上游删除/改写企业段时，收尾钩子兜底放回 |
| `debug` | `false` | 每次组装把最终 section 清单打到服务日志 |

## 目录与接入

```
src/index.ts          插件实现（section 注册 + assemble 收尾钩子）
cordis.patch.yml      Bundle patch：把本 Bundle 作为一行 Cordis 插件插入
tools/verify-assemble.mjs   验证脚本（不起 LLM，直接断言组装结果）
```

接入只需两步（已做，作为后续复制样板）：
1. 目标 profile `package.json` 的 `dsh.profile.bundles` 加 `@my-company/system-prompt-hook`，
   并在其 `node_modules/@my-company/` 软链到本包；
2. 部署 overlay（如 `enterprise/profiles/enterprise.cordis.yml`）用 `- id: system-prompt-hook`
   + `config` 调参（勿改 `cordis.patch.yml`）。

## 验证

```sh
node tools/verify-assemble.mjs     # 17/17 断言
```

场景覆盖：基线无覆盖段 / 默认 after-persona 注入 / before-persona / first /
complete 整体接管（harness identity 消失）/ guard 兜底放回（拦截改写）/ guard 关闭对照 /
空 persona 部署仍有企业覆盖 / 自定义文案 + 关闭工具强制 + debug 打印。

真实 dsh 运行时里，web profile 已开 `debug: true`：UI 发消息后服务日志会出现
`[system-prompt-hook] assemble -> sections: harness:identity(...), deployment:persona(...), enterprise:policy(...)`。
