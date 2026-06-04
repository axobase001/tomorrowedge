# TomorrowEdge / 明日边缘

**中文** | [English](#english)

明日边缘是一个 **TUI-first multi-model agent cockpit for full-access coding workflows**：面向 full-access 代码任务的终端驾驶舱，用来监督、调度、审查、授权多个 AI agents 协作完成软件工程任务。

```text
Full autonomy, full visibility.
完全自治，完全可见。
```

它不是聊天机器人，也不是某个模型的一层 CLI 壳。Codex / Claude Code gives agents full access. TomorrowEdge gives full access a cockpit.

Full 模式是完整工作区工具权限下的自治执行。TomorrowEdge 会自动应用 patch、运行 shell、执行 repair loop，并继续迭代，不会每一步都打断用户确认。

它与黑盒 full-access agent 的区别不是限制权限，而是可见性：每次模型调用、上下文选择、patch、命令、review、judge 裁决、fallback、成本更新和验证结果都会显示在 TUI 中，并写入可回放事件账本。

## 为什么存在

明日边缘存在的原因，是 AI coding 的未来不会是单模型的。
不同模型有不同的能力、价格、上下文长度、延迟与隐私边界。模型厂有动力把用户留在自家模型栈里，但工程团队真正需要的是跨模型的最优组合：用强模型做高价值判断，用高性价比模型做大规模执行，用本地模型守住隐私，用人类授权关键动作。明日边缘就是这个中立编排层，把异构模型组织成一个可监督、可审计、可回滚的软件工程工作流。 OpenRouter 解决“怎么调用多个模型”；TomorrowEdge 解决“怎么让多个模型在一个真实工程任务里分工、争辩、监督、交付”。

## 当前版本

当前版本：`0.4.1`。

这一版的重点是 **MCP Agent Bridge**：让 Claude Code / Codex 等外部 coding agents 通过 MCP 接入 TomorrowEdge，并被用户绑定到 `core`、`planner`、`reviewer`、`judge`、`coder_a`、`repairer` 等 workflow roles。

- `tedge mcp serve` 启动 TomorrowEdge MCP stdio server
- `tedge mcp tools` 查看暴露给外部 agent 的 MCP tools
- `tedge mcp agents` 查看当前启用的 external MCP agents
- `external_agents` 配置块支持 Claude Code / Codex mock profile 和角色允许列表
- `agents.<role>.provider: external:<id>` 支持把 workflow role 显式绑定到外部 agent
- 外部 agent 的 patch、review、judgment、result、cost usage 都会写入 `events.jsonl`
- TUI 的 Agents / Router / Trace panes 会显示 external agent badge、role binding 和 `external_agent_*` 事件
- `0.4.1` 继续强化 release hardening：`npm run verify`、非 git 压缩包 secret scan、full access shell policy、external command runner skeleton，以及本地可运行的 tiny LM demo。

## TUI 实际运行截图

以下截图来自当前配置下的 TomorrowEdge fixture 工作流运行态，不是官网页、生成图或概念图。

![TomorrowEdge TUI runtime cockpit](docs/assets/screenshots/tui-runtime-cockpit.png)

![TomorrowEdge full-access trace ledger](docs/assets/screenshots/tui-runtime-trace.png)

## 快速开始

```bash
node --version   # requires Node >=20.19.0
npm install
npm test
npm run dev -- doctor
npm run verify
npm run dev -- init
npm run dev -- init --force
npm run dev -- run "fix failing test" --headless
npm run dev -- run "fix failing test" --headless --fixture-mode --approve-patch --approve-shell
npm run dev -- tui
```

默认测试和演示都可以离线运行，不需要 API key。云端 provider 只有在显式配置环境变量后才会启用；启用后 `tedge run` 会优先尝试非破坏性 live 候选，必要时仍可用 `--offline` 回到纯离线 fixture/mock 路径。
`npm run dev` 在 WSL 且临时目录落到 Windows mount 时会自动把 `TMPDIR` 切到 `/tmp`，避免 `tsx` IPC socket 失败。

## 核心能力

- 角色化 agent 图：Planner、Explorer、Coder-A/B、Reviewer、Judge、Runner、Repairer、Summarizer
- 多模型路由：OpenRouter、DeepSeek、MiMo、Ollama、本地 mock/fixture、OpenAI-compatible 等
- 能力拼接式路由：图片/截图/流程图先交给 Vision Agent，再把结构化规格交给 coding agent
- 访问模式：`restricted`、`partial`、`full`
- 非破坏性 live advisory：真实模型给计划/实现/评审/裁决建议，但不改文件
- 非破坏性 live patch：真实模型生成候选 diff，但不会自动应用
- provider fallback：主路由不可用时按计划 fallback，并在 `modelNotes` 里记录原因
- 多模型 drill：Core/River 作为 planner/reviewer，比较不同模型完成同一任务的能力
- Core-led workflow：任务拆分、多轮模型辩论、角色执行、Core 审核、报告落盘
- MCP Agent Bridge：把 Claude Code / Codex 等外部 coding agents 绑定为 core/planner/reviewer/judge/coder/repairer
- patch 安全：预览、敏感文件拦截、显式授权、undo snapshot
- 产品化安全基线：shell guard、artifact 脱敏、crypto ID、patch 回滚、任务相关上下文选择
- TUI 驾驶舱：agent 状态、路由、辩论、diff、shell、证据、记忆、帮助面板

## 常用命令

```bash
tedge init
tedge tui
tedge run "task"
tedge run "task" --headless
tedge run "task" --live
tedge run "task" --offline
tedge config
tedge models
tedge models --real-smoke
tedge models --smoke-suite
tedge mode restricted
tedge mode partial
tedge mode full
tedge prefs
tedge drill "task"
tedge workflow "task"
tedge mcp serve
tedge mcp tools
tedge mcp agents
tedge replay latest
tedge trace latest
tedge trace latest --verbose
tedge export latest --format markdown
tedge export latest --brief
tedge export latest --format json --include-artifacts
tedge sessions
tedge memory
tedge review-export latest --format github
tedge undo --list
tedge undo
```

## 权限模式

```bash
tedge mode restricted
tedge mode partial
tedge mode full
tedge run "task" --access-mode restricted
```

- `restricted`：禁止云模型调用和本地变更
- `partial`：允许模型调用，但 patch/shell/repair 需要授权
- `full`：自治执行；自动应用 patch、运行 shell、执行 repair loop，并把每一步写入事件账本

`full` 会自动批准 patch/shell/repair。CLI 会在进入 full autonomy 时输出风险提示；建议先在 clean repo、sandbox 或 fixture 中使用。

## Fixture 演示

完整 approved patch/test loop：

```bash
tedge run "fix failing test" --headless --fixture-mode --approve-patch --approve-shell
```

失败测试后的 Repairer loop：

```bash
tedge run "fix failing test" --headless --fixture-mode --approve-patch --approve-shell --fixture-failing-patch --repair-on-fail --approve-repair
```

没有 `--approve-patch` 不会应用 diff；没有 `--approve-shell` 不会运行测试；没有 `--approve-repair` 只会记录 repair candidate。
从 TomorrowEdge 项目根目录运行 fixture demo 时，CLI 会复制 `tests/fixtures/sample-repo-basic` 到临时目录执行；headless 输出中的 `fixtureWorkspace` 会显示实际执行目录。

## 多模型工作流

非破坏性能力 drill：

```bash
tedge drill "fix the failing add test" --fixture sample-repo-basic --providers openrouter,deepseek,mimo
tedge drill "restore the login screen from the screenshot" --fixture sample-repo-react-ui --providers openrouter,deepseek,mimo
```

完整 Core-led workflow：

```bash
tedge workflow "design and land a real multi-model orchestration workflow" --providers openrouter,deepseek,mimo
tedge workflow "design and land a real multi-model orchestration workflow" --providers openrouter,deepseek,mimo --rounds 2
```

`workflow` 支持 1-5 轮辩论。第 1 轮是角色发言，后续轮次是交叉质询：模型会围绕上轮 transcript 里的矛盾、授权边界和落地风险互相挑战。每个 live batch 都会按 `debate.max_cost_usd` 做预算预检。

## MCP Agent Bridge

TomorrowEdge 不替代 Claude Code / Codex，而是把它们纳入 full-access multi-model cockpit。Codex / Claude Code gives agents full access. TomorrowEdge gives full access a cockpit.
TomorrowEdge 不替代你已经订阅的 Claude Code / Codex，而是把它们变成可编排、可观测的角色节点。

MCP bridge 允许外部 coding agents 承担 `core`、`planner`、`reviewer`、`judge`、`coder_a`、`repairer` 等角色。TomorrowEdge 继续负责 orchestration、routing、trace、event ledger、session export 和 TUI 可视化监督。详见 [docs/MCP_AGENT_BRIDGE.md](docs/MCP_AGENT_BRIDGE.md) 和 [docs/EXTERNAL_AGENT_ROLES.md](docs/EXTERNAL_AGENT_ROLES.md)。

基本用法：

```bash
tedge mcp tools
tedge mcp agents
tedge mcp agents --probe
tedge mcp serve
tedge mcp invoke codex --session latest --role reviewer --prompt "review the current workflow"
tedge trace latest --verbose
```

TomorrowEdge 也不浪费你已经订阅的 Claude Code / Codex：它可以把这些昂贵强 agent 绑定到 planner、reviewer、judge 等关键角色，把大规模探索和实现交给更便宜或本地的模型，从而降低全流程强模型成本。
`external_agents.<id>.command` / `args` / `cwd` / `env` 可用于 command runner skeleton。外部进程通过 stdin 和 `TOMORROWEDGE_EXTERNAL_CONTEXT_FILE` 接收结构化任务上下文，stdout/stderr 会作为 artifact 写入 trace。

## 本地 tiny LM demo

```bash
cd examples/tiny-local-lm
npm install
npm start
npm run verify
```

这个 demo 是本地 char-level n-gram toy language model，不调用 OpenAI/OpenRouter API。它提供 `/health`、`/model-info`、`/generate`，前端支持 prompt、temperature 和 max tokens，用于验证 TomorrowEdge 的多 agent 分工、review、judge、repair 和 export 流程。

角色绑定示例：

```yaml
external_agents:
  claude_code:
    enabled: true
    transport: mcp
    roles: [core, planner, reviewer, judge]
    capabilities: [core, planning, review, judgment]
    trustLevel: high
  codex:
    enabled: true
    transport: mcp
    command: codex
    args: [mcp-server]
    autoStart: true
    roles: [core, coder_a, repairer, reviewer]
    capabilities: [core, coding, repair, review]
    trustLevel: high

agents:
  planner:
    provider: external:claude_code
    model: auto
  reviewer:
    provider: external:codex
    model: auto
  judge:
    provider: external:claude_code
    model: auto
```

## 能力拼接

```bash
tedge run "根据截图还原 React 页面" --image ./screen.png --headless
```

当任务包含图片输入时，TomorrowEdge 会自动插入 Vision Agent：

```text
Image / Screenshot / Diagram
  -> Vision Agent
  -> Structured Visual Spec
  -> Planner / Coder
  -> Patch / Test
  -> Reviewer / Runner
```

这就是能力拼接式模型路由：不是选择一个模型完成所有事情，而是组合一组最合适的能力。OpenRouter 路由请求，TomorrowEdge 路由能力。详见 [docs/CAPABILITY_STITCHING.md](docs/CAPABILITY_STITCHING.md)。

## 安全边界

- 默认 safe mode
- patch 和 shell 默认都需要显式授权
- ignored/sensitive 文件不会进入上下文选择
- suspected secrets 上传云模型前会被拦截
- shell 命令不再通过 `shell: true` 执行；危险命令和 shell 元字符会被拦截
- 事件 artifact 默认脱敏后再保存和导出
- 多文件 patch 写入失败时会回滚已写入文件
- telemetry 默认关闭
- `.env` 和 `.tomorrowedge/` 本地运行态被 git 忽略
- provider fallback 会显式记录，不会伪装成主 provider 成功

## Provider

| Provider | Adapter type | Default enabled | Live smoke | Vision | Status |
|---|---|---:|---:|---:|---|
| `mock` / `fixture` | built-in offline | yes | n/a | fixture | stable |
| OpenRouter | OpenAI-compatible | no | yes, with key | model-dependent | usable |
| DeepSeek | OpenAI-compatible | no | yes, with key | no/limited | usable |
| MiMo | OpenAI-compatible | no | yes, with key | supported when model supports images | usable |
| OpenAI-compatible | generic compatible endpoint | no | yes, with key/base URL | model-dependent | usable |
| Kimi | Moonshot OpenAI-compatible (`kimi-k2.6`) | no | yes, with key | model-dependent | usable |
| Ollama | local | yes | local daemon | model-dependent | usable/local |
| Anthropic | placeholder | no | no | no | planned/native adapter not implemented |
| Gemini | placeholder | no | no | no | planned/native adapter not implemented |

Anthropic/Gemini 目前是显式 placeholder；如果要用 Claude/Opus 或 Gemini 类模型，推荐先通过 OpenRouter 路由，直到 native adapter 实现。

本项目不是 Xiaomi、MiMo、OpenAI、Anthropic、Google、DeepSeek、Moonshot/Kimi 或 OpenRouter 的官方项目。

## UI 风格

明日边缘默认中文 UI，整体风格是简约、克制、偏程序员审美的 terminal cockpit：深色面板、细边框、等宽字体、高信息密度、有限状态色，以及不抢主次的轻科幻工程感。详见 [docs/UI_STYLE.md](docs/UI_STYLE.md)。

## Clean Room

见 [docs/CLEAN_ROOM_NOTE.md](docs/CLEAN_ROOM_NOTE.md)。

---

## English

TomorrowEdge is a **TUI-first multi-model agent cockpit** for coding tasks: a terminal cockpit for supervising, routing, reviewing, authorizing, and auditing multiple AI agents working together on real software engineering workflows.
TomorrowEdge is a **TUI-first multi-model agent cockpit for full-access coding workflows**.
TomorrowEdge is not another agent framework. It is a full-access cockpit for native workflows and existing agent frameworks.

```text
Full autonomy, full visibility.
```

It is not a chatbot CLI and not a single-provider wrapper. Codex / Claude Code gives agents full access. TomorrowEdge gives full access a cockpit.

Full mode is autonomous execution with complete workspace tool access. TomorrowEdge will apply patches, run shell commands, execute repair loops, and continue iterating without per-step confirmation.

The difference from black-box full-access agents is visibility: every model call, context selection, patch, command, review, judge decision, fallback, cost update, and verification result is rendered in the TUI and saved to a replayable event ledger.

## Why It Exists

TomorrowEdge exists because the future of AI coding will not be single-model.
Different models have different capabilities, prices, context lengths, latency profiles, and privacy boundaries. Model vendors have incentives to keep users inside their own stacks, but engineering teams need the best cross-model composition: use strong models for high-value judgment, cost-efficient models for large-scale execution, local models for privacy, and humans for critical authorization. TomorrowEdge is that neutral orchestration layer. It organizes heterogeneous models into a supervised, auditable, reversible software engineering workflow. OpenRouter solves "how to call multiple models"; TomorrowEdge solves "how to make multiple models divide work, debate, supervise, and deliver inside a real engineering task."

## Current Version

Current version: `0.4.1`.

This release introduces the **MCP Agent Bridge**: Claude Code / Codex and other
external coding agents can connect through MCP and be bound to workflow roles
such as `core`, `planner`, `reviewer`, `judge`, `coder_a`, and `repairer`.

- `tedge mcp serve` starts the TomorrowEdge MCP stdio server
- `tedge mcp tools` lists the MCP tools exposed to external agents
- `tedge mcp agents` lists currently enabled external MCP agents
- `external_agents` config supports Claude Code / Codex mock profiles and role
  allowlists
- `agents.<role>.provider: external:<id>` binds a workflow role to an external
  agent
- external patch, review, judgment, result, and cost usage submissions are
  written to `events.jsonl`
- the TUI Agents / Router / Trace panes show external agent badges, role
  bindings, and `external_agent_*` events
- `0.4.1` hardens the release lane with `npm run verify`, zip-safe secret
  scanning, full-access shell policy, an external command runner skeleton, and a
  locally runnable tiny LM demo.

## TUI Runtime Screenshots

These screenshots are captured from the current TomorrowEdge fixture runtime
with the current provider configuration. They are not docs-site screenshots or
generated concept art.

![TomorrowEdge TUI runtime cockpit](docs/assets/screenshots/tui-runtime-cockpit.png)

![TomorrowEdge full-access trace ledger](docs/assets/screenshots/tui-runtime-trace.png)

## Quickstart

```bash
node --version   # requires Node >=20.19.0
npm install
npm test
npm run dev -- doctor
npm run verify
npm run dev -- init
npm run dev -- init --force
npm run dev -- run "fix failing test" --headless
npm run dev -- run "fix failing test" --headless --fixture-mode --approve-patch --approve-shell
npm run dev -- tui
```

All default tests and demos run offline without API keys. Cloud providers are
disabled unless explicitly configured with environment variables; once enabled,
`tedge run` prefers non-mutating live candidates, and `--offline` returns to the
pure fixture/mock path.
When the fixture demo is launched from the TomorrowEdge project root, the CLI copies `tests/fixtures/sample-repo-basic` into a temporary workspace; headless output reports the actual path as `fixtureWorkspace`.
On WSL, `npm run dev` automatically switches `TMPDIR` to `/tmp` when the inherited temp directory points at a Windows mount, avoiding `tsx` IPC socket failures.

## Core Features

- Role-conditioned agent graph: Planner, Explorer, Coder-A/B, Reviewer, Judge, Runner, Repairer, Summarizer
- Multi-model routing across OpenRouter, DeepSeek, MiMo, Ollama, local mock/fixture, OpenAI-compatible providers, and placeholders
- User-configurable provider/model assignment per agent role for controlled model-comparison experiments
- Capability stitching: image/screenshot/diagram inputs go through Vision Agent before coding agents
- Access modes: `restricted`, `partial`, `full`
- First-class event ledger with replayable `events.jsonl` and per-session artifacts
- Artifact-aware trace/export for diffs, reviews, judge decisions, stdout/stderr, and model call refs
- Non-mutating live advisory from routed providers
- Non-mutating live patch candidates from routed providers
- Explicit provider fallback recorded in `modelNotes`
- Multi-model capability drills with Core/River as planner/reviewer
- Core-led workflow with decomposition, multi-round debate, role execution, Core review, and saved reports
- MCP Agent Bridge for binding Claude Code / Codex or other external coding agents to core/planner/reviewer/judge/coder/repairer roles
- Patch safety: preview, sensitive-file blocking, explicit approval, undo snapshots
- Productized safety baseline: guarded shell execution, artifact redaction, crypto IDs, patch rollback, and task-relevant context selection
- TUI cockpit panes for agents, routing, debate, diffs, shell, evidence, memory, and help
- Framework-agnostic orchestration backend abstraction with `native` as the default backend and LangGraph/CrewAI/AutoGen placeholders

## Commands

```bash
tedge init
tedge tui
tedge run "task"
tedge run "task" --headless
tedge run "task" --live
tedge run "task" --offline
tedge config
tedge models
tedge models --real-smoke
tedge mode restricted
tedge mode partial
tedge mode full
tedge prefs
tedge drill "task"
tedge workflow "task"
tedge mcp serve
tedge mcp tools
tedge mcp agents
tedge replay latest
tedge trace latest
tedge trace latest --verbose
tedge export latest --format markdown
tedge export latest --brief
tedge export latest --format json --include-artifacts
tedge sessions
tedge undo --list
tedge undo
```

## Access Modes

- `restricted`: blocks cloud/model calls and local mutations
- `partial`: allows model calls while requiring patch/shell/repair approval
- `full`: autonomous execution with complete workspace tool access; patch/shell/repair loop actions are auto-approved and logged

`full` auto-approves patch, shell, and repair actions. The CLI prints a risk
warning before full-autonomy runs; prefer a clean repo, sandbox, or fixture.

## Workflow

```bash
tedge drill "fix the failing add test" --fixture sample-repo-basic --providers openrouter,deepseek,mimo
tedge workflow "design and land a real multi-model orchestration workflow" --providers openrouter,deepseek,mimo --rounds 2
```

`workflow` supports 1-5 debate rounds. Later rounds are cross-examination rounds over the prior transcript. Each live batch is preflighted against `debate.max_cost_usd`.

## MCP Agent Bridge

TomorrowEdge is not replacing Claude Code / Codex. It turns them into role-bound agents inside a visible multi-model cockpit. Codex / Claude Code gives agents full access. TomorrowEdge gives full access a cockpit.

The MCP bridge lets external coding agents take roles such as `core`, `planner`, `reviewer`, `judge`, `coder_a`, and `repairer`. TomorrowEdge keeps orchestration, routing, trace, event ledger, session export, and TUI supervision. See [docs/MCP_AGENT_BRIDGE.md](docs/MCP_AGENT_BRIDGE.md) and [docs/EXTERNAL_AGENT_ROLES.md](docs/EXTERNAL_AGENT_ROLES.md).
TomorrowEdge does not replace the Claude Code / Codex subscriptions you already have. It turns them into orchestratable and observable role nodes.

Basic usage:

```bash
tedge mcp tools
tedge mcp agents
tedge mcp agents --probe
tedge mcp serve
tedge mcp invoke codex --session latest --role reviewer --prompt "review the current workflow"
tedge trace latest --verbose
```

It also protects existing Claude Code / Codex subscriptions by binding expensive
strong agents to high-value roles such as planner, reviewer, and judge while
cheaper or local models handle broad execution.
`external_agents.<id>.command` / `args` / `cwd` / `env` can also drive the
command runner skeleton. The process receives structured task context through
stdin and `TOMORROWEDGE_EXTERNAL_CONTEXT_FILE`; stdout/stderr are stored as trace
artifacts.

## Local Tiny LM Demo

```bash
cd examples/tiny-local-lm
npm install
npm start
npm run verify
```

The demo is a local char-level n-gram toy language model, not an OpenAI or
OpenRouter API call. It exposes `/health`, `/model-info`, and `/generate`, plus a
frontend with prompt, temperature, and max token controls for orchestration
acceptance drills.

Role binding example:

```yaml
external_agents:
  claude_code:
    enabled: true
    transport: mcp
    roles: [core, planner, reviewer, judge]
    capabilities: [core, planning, review, judgment]
    trustLevel: high
  codex:
    enabled: true
    transport: mcp
    command: codex
    args: [mcp-server]
    autoStart: true
    roles: [core, coder_a, repairer, reviewer]
    capabilities: [core, coding, repair, review]
    trustLevel: high

agents:
  planner:
    provider: external:claude_code
    model: auto
  reviewer:
    provider: external:codex
    model: auto
  judge:
    provider: external:claude_code
    model: auto
```

## Orchestration Backends

TomorrowEdge keeps the cockpit contract even when execution is delegated:

```yaml
orchestration:
  backend: native # native | langgraph | crewai | autogen
```

`native` is executable today and wraps the current TomorrowEdge agent graph.
`langgraph`, `crewai`, and `autogen` are registered placeholders with schema,
docs, and clear unavailable-backend errors. External frameworks are adapters;
they do not own full-access authorization, the event ledger, replay, export, or
TUI visibility.

See [docs/ORCHESTRATION_BACKENDS.md](docs/ORCHESTRATION_BACKENDS.md).

## Capability Stitching

```bash
tedge run "restore this React page from the screenshot" --image ./screen.png --headless
```

When image input is present, TomorrowEdge inserts a Vision Agent:

```text
Image / Screenshot / Diagram
  -> Vision Agent
  -> Structured Visual Spec
  -> Planner / Coder
  -> Patch / Test
  -> Reviewer / Runner
```

This is capability compositional routing: do not choose one model to do
everything; compose the right capability chain for the task. OpenRouter routes
requests. TomorrowEdge routes capabilities. See
[docs/CAPABILITY_STITCHING.md](docs/CAPABILITY_STITCHING.md).

## Safety

- Safe mode is enabled by default
- Patch and shell actions require approval by default
- Ignored and sensitive files are excluded from context selection
- Suspected secrets are blocked before cloud upload
- Shell commands run without `shell: true`; metacharacters and dangerous executables are blocked
- Event artifacts are redacted before persistence/export
- Multi-file patch writes roll back if a later write fails
- Telemetry is disabled by default
- `.env` and local `.tomorrowedge/` runtime state are git-ignored
- Provider fallback is explicit; it does not hide the failed primary route

## Providers

| Provider | Adapter type | Default enabled | Live smoke | Vision | Status |
|---|---|---:|---:|---:|---|
| `mock` / `fixture` | built-in offline | yes | n/a | fixture | stable |
| OpenRouter | OpenAI-compatible | no | yes, with key | model-dependent | usable |
| DeepSeek | OpenAI-compatible | no | yes, with key | no/limited | usable |
| MiMo | OpenAI-compatible | no | yes, with key | supported when model supports images | usable |
| OpenAI-compatible | generic compatible endpoint | no | yes, with key/base URL | model-dependent | usable |
| Kimi | Moonshot OpenAI-compatible (`kimi-k2.6`) | no | yes, with key | model-dependent | usable |
| Ollama | local | yes | local daemon | model-dependent | usable/local |
| Anthropic | placeholder | no | no | no | planned/native adapter not implemented |
| Gemini | placeholder | no | no | no | planned/native adapter not implemented |

Anthropic/Gemini are explicit placeholders today. Route Claude/Opus or Gemini-class models through OpenRouter until native adapters are implemented.

Recommended bilingual config / 推荐配置:

```yaml
providers:
  openrouter:
    enabled: true
    api_key_env: OPENROUTER_API_KEY
    base_url: https://openrouter.ai/api/v1
    model: openai/gpt-5.2
    api_format: openai_chat
    auth_header: bearer
  deepseek:
    enabled: true
    api_key_env: DEEPSEEK_API_KEY
    base_url: https://api.deepseek.com
    model: deepseek-v4-pro
    api_format: openai_chat
    auth_header: bearer
  mimo:
    enabled: true
    api_key_env: MIMO_API_KEY
    base_url: https://token-plan-sgp.xiaomimimo.com/v1
    model: mimo-v2.5-pro
    api_format: openai_chat
    auth_header: api-key

agents:
  vision: { provider: mimo, model: mimo-v2.5-pro }
  planner: { provider: openrouter, model: openai/gpt-5.2 }
  explorer: { provider: deepseek, model: deepseek-v4-pro }
  coder_a: { provider: deepseek, model: deepseek-v4-pro }
  reviewer: { provider: openrouter, model: anthropic/claude-opus-4.1 }
  judge: { provider: openrouter, model: openai/gpt-5.2 }
```

This is a recommended starting point, not a hardcoded assignment. Users can
replace `providers.<id>.model` or any `agents.<role>.provider/model` entry to
compare GPT, Claude/Opus, DeepSeek, MiMo, Kimi, Ollama, or any compatible model.
`auth_header` supports `bearer`, `api-key`, and `none`; `api_format` supports
`openai_chat` and `legacy_chat`.

This is not an official Xiaomi, MiMo, OpenAI, Anthropic, Google, DeepSeek, Moonshot/Kimi, or OpenRouter project.

## UI Style

TomorrowEdge defaults to Chinese UI copy and uses a restrained programmer-facing terminal cockpit style: dark panes, thin borders, monospaced text, dense state panels, limited status colors, and subtle sci-fi engineering accents that never outrank the workflow. See [docs/UI_STYLE.md](docs/UI_STYLE.md).
