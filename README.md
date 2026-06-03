# TomorrowEdge / 明日边缘

**中文** | [English](#english)

明日边缘是一个 **TUI-first multi-model agent cockpit**：面向代码任务的终端驾驶舱，用来监督、调度、审查、授权多个 AI agents 协作完成软件工程任务。

它不是聊天机器人，也不是某个模型的一层 CLI 壳。它把 agentic coding 从一条黑盒命令，变成一个可见、可监督、可审计、可回滚的工作流：强模型负责计划与裁决，高性价比模型负责探索与实现，本地模型负责隐私，人类负责授权真正重要的动作。

## 为什么存在

明日边缘存在的原因，是 AI coding 的未来不会是单模型的。
不同模型有不同的能力、价格、上下文长度、延迟与隐私边界。模型厂有动力把用户留在自家模型栈里，但工程团队真正需要的是跨模型的最优组合：用强模型做高价值判断，用高性价比模型做大规模执行，用本地模型守住隐私，用人类授权关键动作。明日边缘就是这个中立编排层，把异构模型组织成一个可监督、可审计、可回滚的软件工程工作流。 OpenRouter 解决“怎么调用多个模型”；TomorrowEdge 解决“怎么让多个模型在一个真实工程任务里分工、争辩、监督、交付”。

## 快速开始

```bash
npm install
npm test
npm run dev -- doctor
npm run dev -- init
npm run dev -- run "fix failing test" --headless
npm run dev -- run "fix failing test" --headless --provider fixture
npm run dev -- tui
```

默认测试和演示都可以离线运行，不需要 API key。云端 provider 只有在显式配置环境变量后才会启用。

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
- patch 安全：预览、敏感文件拦截、显式授权、undo snapshot
- TUI 驾驶舱：agent 状态、路由、辩论、diff、shell、证据、记忆、帮助面板

## 常用命令

```bash
tedge init
tedge tui
tedge run "task"
tedge run "task" --headless
tedge config
tedge models
tedge models --real-smoke
tedge mode restricted
tedge mode partial
tedge mode full
tedge prefs
tedge drill "task"
tedge workflow "task"
tedge replay latest
tedge sessions
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
- `full`：自动授权 patch/shell/repair

## Fixture 演示

完整 approved patch/test loop：

```bash
tedge run "fix failing test" --headless --provider fixture --approve-patch --approve-shell
```

失败测试后的 Repairer loop：

```bash
tedge run "fix failing test" --headless --provider fixture --approve-patch --approve-shell --fixture-failing-patch --repair-on-fail --approve-repair
```

没有 `--approve-patch` 不会应用 diff；没有 `--approve-shell` 不会运行测试；没有 `--approve-repair` 只会记录 repair candidate。

## 多模型工作流

非破坏性能力 drill：

```bash
tedge drill "fix the failing add test" --fixture sample-repo-basic --providers openrouter,deepseek,mimo
```

完整 Core-led workflow：

```bash
tedge workflow "design and land a real multi-model orchestration workflow" --providers openrouter,deepseek,mimo
tedge workflow "design and land a real multi-model orchestration workflow" --providers openrouter,deepseek,mimo --rounds 2
```

`workflow` 支持 1-5 轮辩论。第 1 轮是角色发言，后续轮次是交叉质询：模型会围绕上轮 transcript 里的矛盾、授权边界和落地风险互相挑战。每个 live batch 都会按 `debate.max_cost_usd` 做预算预检。

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
- telemetry 默认关闭
- `.env` 和 `.tomorrowedge/` 本地运行态被 git 忽略
- provider fallback 会显式记录，不会伪装成主 provider 成功

## Provider

离线 provider：

- `mock`
- `fixture`

可配置 provider：

- OpenRouter
- DeepSeek-compatible
- MiMo-compatible
- OpenAI-compatible
- Kimi-compatible placeholder
- Ollama local
- Anthropic/Gemini placeholders

本项目不是 Xiaomi、MiMo、OpenAI、Anthropic、Google、DeepSeek、Moonshot/Kimi 或 OpenRouter 的官方项目。

## UI 风格

明日边缘默认中文 UI，整体风格是简约、克制、偏程序员审美的 terminal cockpit：深色面板、细边框、等宽字体、高信息密度、有限状态色，以及不抢主次的轻科幻工程感。详见 [docs/UI_STYLE.md](docs/UI_STYLE.md)。

## Clean Room

见 [docs/CLEAN_ROOM_NOTE.md](docs/CLEAN_ROOM_NOTE.md)。

---

## English

TomorrowEdge is a **TUI-first multi-model agent cockpit** for coding tasks: a terminal cockpit for supervising, routing, reviewing, authorizing, and auditing multiple AI agents working together on real software engineering workflows.

It is not a chatbot CLI and not a single-provider wrapper. It turns agentic coding from a black-box command into a visible, supervised, auditable, and reversible workflow: strong models plan and judge, efficient models explore and implement, local models protect privacy, and humans authorize the actions that matter.

## Why It Exists

TomorrowEdge exists because the future of AI coding will not be single-model.
Different models have different capabilities, prices, context lengths, latency profiles, and privacy boundaries. Model vendors have incentives to keep users inside their own stacks, but engineering teams need the best cross-model composition: use strong models for high-value judgment, cost-efficient models for large-scale execution, local models for privacy, and humans for critical authorization. TomorrowEdge is that neutral orchestration layer. It organizes heterogeneous models into a supervised, auditable, reversible software engineering workflow. OpenRouter solves "how to call multiple models"; TomorrowEdge solves "how to make multiple models divide work, debate, supervise, and deliver inside a real engineering task."

## Quickstart

```bash
npm install
npm test
npm run dev -- doctor
npm run dev -- init
npm run dev -- run "fix failing test" --headless
npm run dev -- run "fix failing test" --headless --provider fixture
npm run dev -- tui
```

All default tests and demos run offline without API keys. Cloud providers are disabled unless explicitly configured with environment variables.

## Core Features

- Role-conditioned agent graph: Planner, Explorer, Coder-A/B, Reviewer, Judge, Runner, Repairer, Summarizer
- Multi-model routing across OpenRouter, DeepSeek, MiMo, Ollama, local mock/fixture, OpenAI-compatible providers, and placeholders
- Capability stitching: image/screenshot/diagram inputs go through Vision Agent before coding agents
- Access modes: `restricted`, `partial`, `full`
- Non-mutating live advisory from routed providers
- Non-mutating live patch candidates from routed providers
- Explicit provider fallback recorded in `modelNotes`
- Multi-model capability drills with Core/River as planner/reviewer
- Core-led workflow with decomposition, multi-round debate, role execution, Core review, and saved reports
- Patch safety: preview, sensitive-file blocking, explicit approval, undo snapshots
- TUI cockpit panes for agents, routing, debate, diffs, shell, evidence, memory, and help

## Commands

```bash
tedge init
tedge tui
tedge run "task"
tedge run "task" --headless
tedge config
tedge models
tedge models --real-smoke
tedge mode restricted
tedge mode partial
tedge mode full
tedge prefs
tedge drill "task"
tedge workflow "task"
tedge replay latest
tedge sessions
tedge undo --list
tedge undo
```

## Access Modes

- `restricted`: blocks cloud/model calls and local mutations
- `partial`: allows model calls while requiring patch/shell/repair approval
- `full`: auto-approves patch/shell/repair actions

## Workflow

```bash
tedge drill "fix the failing add test" --fixture sample-repo-basic --providers openrouter,deepseek,mimo
tedge workflow "design and land a real multi-model orchestration workflow" --providers openrouter,deepseek,mimo --rounds 2
```

`workflow` supports 1-5 debate rounds. Later rounds are cross-examination rounds over the prior transcript. Each live batch is preflighted against `debate.max_cost_usd`.

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
- Telemetry is disabled by default
- `.env` and local `.tomorrowedge/` runtime state are git-ignored
- Provider fallback is explicit; it does not hide the failed primary route

## Providers

Offline providers: `mock`, `fixture`.

Configurable providers: OpenRouter, DeepSeek-compatible, MiMo-compatible, OpenAI-compatible, Kimi-compatible placeholder, Ollama local, Anthropic/Gemini placeholders.

This is not an official Xiaomi, MiMo, OpenAI, Anthropic, Google, DeepSeek, Moonshot/Kimi, or OpenRouter project.

## UI Style

TomorrowEdge defaults to Chinese UI copy and uses a restrained programmer-facing terminal cockpit style: dark panes, thin borders, monospaced text, dense state panels, limited status colors, and subtle sci-fi engineering accents that never outrank the workflow. See [docs/UI_STYLE.md](docs/UI_STYLE.md).
