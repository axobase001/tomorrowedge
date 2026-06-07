# TomorrowEdge / 明日边缘

[![CI](https://github.com/axobase001/tomorrowedge/actions/workflows/ci.yml/badge.svg)](https://github.com/axobase001/tomorrowedge/actions/workflows/ci.yml)

**中文** | [English](#english)

明日边缘是一个 **local GUI client for full-access multi-model coding workflows**：面向 full-access 代码任务的本地驾驶舱，用来监督、调度、审查、授权多个 AI agents 协作完成软件工程任务。

```text
Full autonomy, full visibility.
完全自治，完全可见。
```

它不是聊天机器人，也不是某个模型的一层 CLI 壳。Codex / Claude Code gives agents full access. TomorrowEdge gives full access a cockpit.

Full 模式是完整工作区工具权限下的自治执行。TomorrowEdge 会自动应用 patch、运行 shell、执行 repair loop，并继续迭代，不会每一步都打断用户确认。

它与黑盒 full-access agent 的区别不是限制权限，而是可见性：每次模型调用、上下文选择、patch、命令、review、judge 裁决、fallback、成本更新和验证结果都会显示在 GUI client 中，并写入可回放事件账本。

## 为什么存在

明日边缘存在的原因，是 AI coding 的未来不会是单模型的。
不同模型有不同的能力、价格、上下文长度、延迟与隐私边界。模型厂有动力把用户留在自家模型栈里，但工程团队真正需要的是跨模型的最优组合：用强模型做高价值判断，用高性价比模型做大规模执行，用本地模型守住隐私，用人类授权关键动作。明日边缘就是这个中立编排层，把异构模型组织成一个可监督、可审计、可回滚的软件工程工作流。 OpenRouter 解决“怎么调用多个模型”；TomorrowEdge 解决“怎么让多个模型在一个真实工程任务里分工、争辩、监督、交付”。

## 当前版本

当前版本：`1.2.0`。

- `Unreleased` encrypts API key storage with AES-256 and adds a 🔑 Keys management panel to the GUI cockpit, so provider keys are never stored as plaintext on disk.
- `1.2.0` GUI client adds first-run provider/model setup, local env-key storage, provider connection testing, and a composer-side access-mode dropdown for `restricted` / `partial` / `full`.
- `1.1.10` GUI CSS now supports OS dark mode in the React and fallback HTML cockpits, and the fallback HTML cockpit no longer hard-locks 1080px/980px minimum widths.
- `1.1.9` GUI detail drawer now includes a capability dashboard backed by a product registry for workflow ledger, provider routing, evidence/budget/cost telemetry, MCP external agents, orchestration adapters, and GUI readiness.
- `1.1.8` GUI detail drawer now includes an approval-history timeline with approvalId, actor/source, blocked-progress reason, diff/output refs, undo snapshots, and patch/shell/pending/completed filter tags.
- `1.1.7` GUI session source badges now distinguish live session, saved snapshot, fixture demo, and API unavailable states, with connection, fixture, and stale snapshot markers.
- `1.1.6` 新增正式 GUI cockpit E2E smoke：CI 会启动编译后的 `tedge client --no-open --port 0`，用 Playwright 打开 nonce URL，提交 fixture 任务，等待 approval，打开 drawer，并检查 1440/1180/768/390px 无横向溢出；失败时上传截图、trace 和脱敏 server log。

- `1.1.5` 是 GitHub issue 队列加固版：合并 local cockpit API 安全校验、React GUI client 接入、desktop launcher 生命周期测试、package zip/pack smoke、README promise map，并补上 CLI contract 测试与 benchmark demo 警告。

- `1.1.4` 修正 GUI/desktop 品牌标识：客户端顶部栏、favicon 和 web manifest 现在使用 TomorrowEdge 几何 mark，不再退回浏览器默认图标。

- `1.1.3` 修复 GUI command composer 的严重交互问题：Enter 现在发送自然语言指令，Shift+Enter 保留换行，并保护中文/日文/韩文输入法 composition，不会在组词中误发送。
- `1.1.2` 新增可选本地桌面 app 启动方式：`tedge desktop` / `npm run desktop` 会复用同一套 nonce-protected local cockpit，在独立桌面窗口中打开 TomorrowEdge。默认不强制安装 Electron；需要 Electron 壳时可使用 `--runtime electron`。
- `1.1.1` 把主入口收口为 **TomorrowEdge GUI Client**：新增 `tedge client` / `npm run client`，README 隐藏 TUI 截图介绍和 UI style 说明，让用户第一次启动时只看到一个清晰客户端入口。
- `1.1.0` 引入 **TomorrowEdge GUI Client**：简化顶栏、轻量任务队列、中心 workflow 主区、右侧 collapsed telemetry summary，以及底部自然语言 command composer。GUI 是默认操作者入口，而不是后台管理系统。
- `1.0.1` 是 1.0 后的稳定性修复版本：修正 live provider agent kind 标记，补上真实 Ink raw-mode 键盘 smoke 测试，并清理/关闭当前远端 issue 与过期 PR。
- `1.0.0` 的重点是 **Architecture Upgrade Phase 1**：引入 context projection、evidence packet、role-routing diagnostics、strong-agent budget scaffolding 和 typed external-agent handoff contracts。

- TomorrowEdge preserves full artifacts for replay, but projects compact evidence packets to models.
- Reviewer/Judge 可以消费结构化 evidence packets，而不是只看 raw diff/log。
- `tedge trace latest --diagnostics` 和 `tedge diagnostics latest` 会显示 routing、fallback、projection、budget、repair、trace completeness。
- 外部 agent handoff 新增 typed task/result envelopes，为真实 Codex/Claude Code role binding 打基础。

Capability maturity: see [Capability Status](docs/CAPABILITY_STATUS.md) for the
authoritative stable / experimental / placeholder / planned table.
README GUI, desktop, and release-package promises are tracked in
[README Promise Map](docs/README_PROMISE_MAP.md).

## 3-minute tryout

```bash
git clone https://github.com/axobase001/tomorrowedge
cd tomorrowedge
npm ci
npm run verify
npm run dev -- run "fix failing test" --headless --fixture-mode --approve-patch --approve-shell
npm run dev -- trace latest --verbose
npm run client
# optional standalone desktop window
npm run desktop
```

No API key required. This runs the offline fixture workflow, applies a safe
fixture patch, runs verification, and shows the replayable event ledger.

## GUI Client Runtime Screenshots

These screenshots are captured from the local browser cockpit opened by
`tedge client` against a fixture session. They are runtime screenshots,
not image2 reference boards.

**Approval-first main workspace**

![TomorrowEdge GUI waiting approval](docs/ui/screenshots/gui-v1.1/waiting-approval.png)

**Details drawer fully open**

![TomorrowEdge GUI details drawer](docs/ui/screenshots/gui-v1.1/drawer-fully-open-1440.png)

**Approval action applied**

![TomorrowEdge GUI approval action applied](docs/ui/screenshots/gui-v1.1/approval-action-applied.png)

**Live running state**

![TomorrowEdge GUI live running state](docs/ui/screenshots/gui-v1.1/running-live.png)

**Telemetry expanded**

![TomorrowEdge GUI telemetry expanded](docs/ui/screenshots/gui-v1.1/telemetry-expanded.png)

**Muted failure diagnosis**

![TomorrowEdge GUI failed state](docs/ui/screenshots/gui-v1.1/failed-state.png)

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
npm run client
```

`npm run client` 会打开 TomorrowEdge GUI Client。安装后的 CLI 可使用 `tedge client`；只想打印本地地址时使用 `tedge client --no-open`。
`tedge client` 默认服务构建后的 React cockpit；仅在缺少 `dist/cockpit-web` 时回退到内置 HTML fallback。

可选桌面窗口：

```bash
npm run desktop
tedge desktop
tedge desktop --runtime app-mode
tedge desktop --runtime electron
```

`desktop` 仍然只绑定本机 `127.0.0.1`，并复用同一套事件账本、审批动作和 GUI view model。默认 `auto` 会优先使用可选 Electron；未安装 Electron 时使用系统 Chromium/Edge 的 app-window 模式；再不行才退回普通本地浏览器窗口。
只有需要 Electron 壳时才安装：`npm install --save-dev electron`。

深度演示与排障：

- [端到端工作流案例：fixture repair loop](docs/WORKFLOW_CASE_STUDY.md)
- [Provider / MCP / full mode troubleshooting](docs/TROUBLESHOOTING.md)

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
- GUI client：任务队列、workflow 主焦点、审批动作、telemetry、details drawer、trace strip 和自然语言 command composer
- 可选桌面 app 窗口：`tedge desktop` 复用本地 GUI client，不复制运行时核心
- 共享 cockpit ViewModel/API：便于 GUI client 和后续客户端复用同一运行态

## 常用命令

```bash
tedge init
tedge client
tedge client --no-open
tedge desktop
tedge desktop --runtime app-mode
tedge desktop --runtime electron
tedge targets
tedge ask --to reviewer "is this patch safe?"
tedge run "task"
tedge run --to debate "task"
tedge run "task" --headless
tedge run "task" --live
tedge run "task" --offline
tedge config
tedge models
tedge models --refresh-free
tedge models --configure-free moonshotai/kimi-k2.6:free --free-first
tedge models --connection-test
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
tedge mcp agents --diagnose
tedge replay latest
tedge trace latest
tedge trace latest --verbose
tedge export latest --format markdown
tedge export latest --brief
tedge export latest --format json --include-artifacts
tedge sessions
tedge memory
tedge review-export latest --format github
tedge github-report latest --repo owner/repo --pr 123 --dry-run
tedge github-report latest --repo owner/repo --pr 123 --post-comment
tedge github-report latest --repo owner/repo --pr 123 --post-check
tedge undo --list
tedge undo
```

`--post-check` 会通过 `gh api` 创建 GitHub Checks API check run；目标仓库的 token
需要允许创建 check run。

GUI command composer 是自然语言任务和审批反馈的主入口。CLI 命令仍可用于脚本化运行、配置和自动化。

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

Shell execution is governed by `shell.policy`:

- `unrestricted`: Codex-style executable invocation with arbitrary executable
  plus args, executed with `shell: false`; shell metacharacters such as `&&`,
  pipes, and redirects are still blocked.
- `verification_allowlist`: only common verification commands such as `npm`,
  `node`, `pytest`, `cargo`, `make`, `cmake`, `go`, `uv`, `bun`, and `deno`.
- `approval_required`: user confirmation is required before shell execution.

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

MCP bridge 允许外部 coding agents 承担 `core`、`planner`、`reviewer`、`judge`、`coder_a`、`repairer` 等角色。TomorrowEdge 继续负责 orchestration、routing、trace、event ledger、session export 和 cockpit 可视化监督。详见 [docs/MCP_AGENT_BRIDGE.md](docs/MCP_AGENT_BRIDGE.md) 和 [docs/EXTERNAL_AGENT_ROLES.md](docs/EXTERNAL_AGENT_ROLES.md)。

基本用法：

```bash
tedge mcp tools
tedge mcp agents
tedge mcp agents --diagnose
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

这个 demo 是本地中英双语 hashed neural n-gram toy language model，默认约 50M 参数，不调用 OpenAI/OpenRouter API。它提供 `/health`、`/model-info`、`/generate`，前端支持 prompt、temperature 和 max tokens，用于验证 TomorrowEdge 的多 agent 分工、review、judge、repair 和 export 流程。

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
- `.env` 和 `.tomorrowedge/` 本地运行态被 git 忽略；发布/分享代码包请使用 `npm run package:zip`，它会排除 `.env*` 并执行 secret scan
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
| Anthropic | native Messages API | no | yes, with key | text + image URL/data URL | usable |
| Gemini | native generateContent API | no | yes, with key | text + data URL images | usable |

Anthropic/Gemini now use native REST adapters. OpenRouter is still the easiest
onboarding route when you want one key for many model families, but Claude and
Gemini keys can be configured directly for high-value review, judgment, and
vision roles.

本项目不是 Xiaomi、MiMo、OpenAI、Anthropic、Google、DeepSeek、Moonshot/Kimi 或 OpenRouter 的官方项目。

## Clean Room

见 [docs/CLEAN_ROOM_NOTE.md](docs/CLEAN_ROOM_NOTE.md)。

---

## English

TomorrowEdge is a **local GUI client for full-access multi-model coding workflows**: a cockpit for supervising, routing, reviewing, authorizing, and auditing multiple AI agents working together on real software engineering tasks.
TomorrowEdge is a **multi-model coding-agent cockpit with a local GUI client**.
TomorrowEdge is not another agent framework. It is a full-access cockpit for native workflows and existing agent frameworks.

```text
Full autonomy, full visibility.
```

It is not a chatbot CLI and not a single-provider wrapper. Codex / Claude Code gives agents full access. TomorrowEdge gives full access a cockpit.

Full mode is autonomous execution with complete workspace tool access. TomorrowEdge will apply patches, run shell commands, execute repair loops, and continue iterating without per-step confirmation.

The difference from black-box full-access agents is visibility: every model call, context selection, patch, command, review, judge decision, fallback, cost update, and verification result is rendered in the local GUI client and saved to a replayable event ledger.

## Why It Exists

TomorrowEdge exists because the future of AI coding will not be single-model.
Different models have different capabilities, prices, context lengths, latency profiles, and privacy boundaries. Model vendors have incentives to keep users inside their own stacks, but engineering teams need the best cross-model composition: use strong models for high-value judgment, cost-efficient models for large-scale execution, local models for privacy, and humans for critical authorization. TomorrowEdge is that neutral orchestration layer. It organizes heterogeneous models into a supervised, auditable, reversible software engineering workflow. OpenRouter solves "how to call multiple models"; TomorrowEdge solves "how to make multiple models divide work, debate, supervise, and deliver inside a real engineering task."

## Current Version

Current version: `1.2.0`.

`1.1.10` adds OS dark-mode CSS support to both the React and fallback HTML
cockpits, and removes the fallback cockpit's old 1080px/980px hard min-width
locks.

`1.1.9` adds a capability dashboard to the GUI detail drawer, backed by a
product registry for workflow ledger, provider routing, evidence/budget/cost
telemetry, MCP external agents, orchestration adapters, and GUI readiness.

`1.1.8` adds an approval-history timeline to the GUI detail drawer. It exposes
approvalId, actor/source, blocked-progress reasons, diff/output refs, undo
snapshots, and patch/shell/pending/completed filter tags.

`1.1.7` clears the GUI session-source issue cluster. The shared ViewModel now
distinguishes live sessions, saved snapshots, fixture demos, and API-unavailable
states, and the GUI top bar shows connection, fixture, and stale snapshot badges.

`1.1.6` adds the first real GUI cockpit E2E smoke. CI starts the compiled
`tedge client --no-open --port 0` entrypoint, opens the nonce URL with
Playwright, submits a fixture task, waits for approval, opens the drawer, and
checks 1440/1180/768/390px layouts for horizontal overflow. Failures upload
screenshots, trace zips, and redacted server logs.

`1.1.5` is a GitHub issue-queue hardening release: local cockpit API safety
checks, React GUI client wiring, desktop launcher lifecycle tests, package
zip/pack smoke coverage, README promise mapping, CLI contract tests, and a
clear benchmark demo warning.

`1.1.4` fixes the GUI/desktop branding mark. The client top bar, favicon, and
web manifest now use the TomorrowEdge geometric mark instead of falling back to
the default browser/app icon.

`1.1.3` fixes the GUI command composer interaction: Enter now sends the
natural-language command, Shift+Enter still inserts a newline, and IME
composition is protected so Chinese/Japanese/Korean input is not submitted
mid-composition.

`1.1.2` adds an optional local desktop app entrypoint. `tedge desktop` /
`npm run desktop` reuse the same nonce-protected local cockpit and open it in a
standalone desktop window. Electron is optional; `--runtime electron` uses it
when installed, while `--runtime app-mode` uses a Chromium/Edge app window.

`1.1.1` makes the **TomorrowEdge GUI Client** the clear default entrypoint:
`tedge client` / `npm run client` now open the client, and the README landing
flow hides TUI screenshots and UI style exposition so first-time users see one
obvious way into the cockpit.

`1.1.0` adds the **TomorrowEdge GUI Client**: simplified top bar,
reduced-border task queue, center workflow main area, collapsed telemetry
summary, and a short natural-language command composer. The GUI follows an
image2-first refinement flow toward a Codex-like quiet cockpit instead of an
admin dashboard.

`1.0.1` is the first post-1.0 stability release. It fixes live routed agent
classification, adds a real Ink raw-mode keyboard smoke test, and closes
the current public issue/PR queue after the 1.0 hardening pass.

`1.0.0` promoted TomorrowEdge to a stable major baseline: the project now has a
usable cockpit surface, a full-access workflow ledger, role-routed
multi-model execution, provider onboarding, MCP/external-agent contracts, and
the first architecture upgrade layers needed for auditable engineering runs.

- TomorrowEdge preserves full artifacts for replay, but projects compact
  evidence packets to models.
- Reviewer/Judge can consume structured evidence packets rather than only raw
  diffs and logs.
- `tedge trace latest --diagnostics` and `tedge diagnostics latest` expose
  routing, fallback, projection, budget, repair, and trace completeness signals.
- External agent handoff now has typed task/result envelopes for real
  Codex/Claude Code role binding.
- The GUI client is the default operator surface for task queue, workflow
  focus, approval actions, telemetry, details, and natural-language commands.

The previous **MCP Agent Bridge** remains available: Claude Code / Codex and
other external coding agents can connect through MCP and be bound to workflow
roles such as `core`, `planner`, `reviewer`, `judge`, `coder_a`, and
`repairer`.

- `tedge mcp serve` starts the TomorrowEdge MCP stdio server
- `tedge mcp tools` lists the MCP tools exposed to external agents
- `tedge mcp agents` lists currently enabled external MCP agents
- `external_agents` config supports Claude Code / Codex mock profiles and role
  allowlists
- `agents.<role>.provider: external:<id>` binds a workflow role to an external
  agent
- external patch, review, judgment, result, and cost usage submissions are
  written to `events.jsonl`
- the GUI client and trace exports show external agent badges, role
  bindings, and `external_agent_*` events
- `1.1.0` keeps the hardened release lane: `npm run verify`, zip-safe secret
  scanning, full-access shell policy, command runner skeletons, and the locally
  runnable tiny LM demo remain available.

## 3-minute tryout

```bash
git clone https://github.com/axobase001/tomorrowedge
cd tomorrowedge
npm ci
npm run verify
npm run dev -- run "fix failing test" --headless --fixture-mode --approve-patch --approve-shell
npm run dev -- trace latest --verbose
npm run client
# optional standalone desktop window
npm run desktop
```

No API key required. This runs the offline fixture workflow, applies a safe
fixture patch, runs verification, and shows the replayable event ledger.

## GUI Client Runtime Screenshots

These screenshots are captured from the local browser cockpit opened by
`tedge client` against a fixture session. They are runtime screenshots,
not image2 reference boards.

**Approval-first main workspace**

![TomorrowEdge GUI waiting approval](docs/ui/screenshots/gui-v1.1/waiting-approval.png)

**Details drawer fully open**

![TomorrowEdge GUI details drawer](docs/ui/screenshots/gui-v1.1/drawer-fully-open-1440.png)

**Approval action applied**

![TomorrowEdge GUI approval action applied](docs/ui/screenshots/gui-v1.1/approval-action-applied.png)

**Live running state**

![TomorrowEdge GUI live running state](docs/ui/screenshots/gui-v1.1/running-live.png)

**Telemetry expanded**

![TomorrowEdge GUI telemetry expanded](docs/ui/screenshots/gui-v1.1/telemetry-expanded.png)

**Muted failure diagnosis**

![TomorrowEdge GUI failed state](docs/ui/screenshots/gui-v1.1/failed-state.png)

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
npm run client
```

`npm run client` opens the TomorrowEdge GUI Client. For installed builds, use
`tedge client`; use `tedge client --no-open` when you only want the local URL.
`tedge client` serves the built React cockpit by default and falls back to the
embedded HTML client only when `dist/cockpit-web` is unavailable.
On first launch, the GUI setup wizard asks for a provider, one model id, and an
API-key env var or optional local key. OpenRouter is the recommended starting
point because one key can reach multiple model families, but role-routing
presets such as cheap-first or strong-review are optional and can be tuned
later. The natural-language composer includes a mode dropdown beside the input
so each task can run as `restricted`, `partial`, or `full`.

Optional desktop window:

```bash
npm run desktop
tedge desktop
tedge desktop --runtime app-mode
tedge desktop --runtime electron
```

`desktop` remains local-only on `127.0.0.1` and reuses the same event ledger,
approval actions, and GUI view model. The default `auto` runtime prefers
optional Electron when installed, then Chromium/Edge app-window mode, then a
normal local browser window.
Install Electron only if you want that shell: `npm install --save-dev electron`.

Deep demo and troubleshooting:

- [End-to-end workflow case study: fixture repair loop](docs/WORKFLOW_CASE_STUDY.md)
- [Provider / MCP / full mode troubleshooting](docs/TROUBLESHOOTING.md)

All default tests and demos run offline without API keys. Cloud providers are
disabled unless explicitly configured with environment variables; once enabled,
`tedge run` prefers non-mutating live candidates, and `--offline` returns to the
pure fixture/mock path.
When the fixture demo is launched from the TomorrowEdge project root, the CLI copies `tests/fixtures/sample-repo-basic` into a temporary workspace; headless output reports the actual path as `fixtureWorkspace`.
On WSL, `npm run dev` automatically switches `TMPDIR` to `/tmp` when the inherited temp directory points at a Windows mount, avoiding `tsx` IPC socket failures.

## Core Features

- Role-conditioned agent graph: Planner, Explorer, Coder-A/B, Reviewer, Judge, Runner, Repairer, Summarizer
- Multi-model routing across OpenRouter, DeepSeek, MiMo, Anthropic, Gemini, Ollama, local mock/fixture, and OpenAI-compatible providers
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
- GUI client for task queue, workflow focus, approval execution, telemetry,
  details drawer, trace strip, and natural-language commands
- Optional desktop app window via `tedge desktop`, reusing the local GUI client
  without forking the runtime core
- Shared cockpit ViewModel/API contract for the GUI client and future packaged
  client surfaces
- Conversation Targets for `core`, role-specific questions, debate-room broadcasts, and external agents
- Framework-agnostic orchestration backend abstraction with `native` as the default backend and LangGraph/CrewAI/AutoGen placeholders

## Commands

```bash
tedge init
tedge client
tedge client --no-open
tedge desktop
tedge desktop --runtime app-mode
tedge desktop --runtime electron
tedge targets
tedge ask --to reviewer "is this patch safe?"
tedge run "task"
tedge run --to debate "task"
tedge run "task" --headless
tedge run "task" --live
tedge run "task" --offline
tedge config
tedge models
tedge models --refresh-free
tedge models --configure-free moonshotai/kimi-k2.6:free --free-first
tedge models --connection-test
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
tedge mcp agents --diagnose
tedge replay latest
tedge trace latest
tedge trace latest --verbose
tedge export latest --format markdown
tedge export latest --brief
tedge export latest --format json --include-artifacts
tedge sessions
tedge memory
tedge review-export latest --format github
tedge github-report latest --repo owner/repo --pr 123 --dry-run
tedge github-report latest --repo owner/repo --pr 123 --post-comment
tedge github-report latest --repo owner/repo --pr 123 --post-check
tedge undo --list
tedge undo
```

`--post-check` creates a GitHub Checks API check run through `gh api`; the token must be
allowed to create check runs for the target repository.

The GUI command composer is the primary client entrypoint for natural-language
tasks and approval feedback. CLI commands remain available for scripted runs and
automation.

## Conversation Targets

TomorrowEdge Core is the default natural-language conversation object. Users can
also address a specific role or external agent while the cockpit keeps ownership
of orchestration, routing, trace, session export, and supervision.

```bash
tedge targets
tedge ask --to core "what should happen next?"
tedge ask --to reviewer "is this diff safe to approve?"
tedge ask --to judge "should we select or request revision?"
tedge ask --to agent:codex "review the latest session"
tedge run --to debate "implement this feature after multi-agent debate"
```

Every directed message records `conversation_target` and
`conversation_message` events. Markdown and JSON exports include the chosen
target, and the cockpit view shows the selected conversation target.

## Access Modes

- `restricted`: blocks cloud/model calls and local mutations
- `partial`: allows model calls while requiring patch/shell/repair approval
- `full`: autonomous execution with complete workspace tool access; patch/shell/repair loop actions are auto-approved and logged

`full` auto-approves patch, shell, and repair actions. The CLI prints a risk
warning before full-autonomy runs; prefer a clean repo, sandbox, or fixture.

Shell execution is governed by `shell.policy`:

- `unrestricted`: Codex-style executable invocation with arbitrary executable
  plus args, executed with `shell: false`; shell metacharacters such as `&&`,
  pipes, and redirects are still blocked.
- `verification_allowlist`: only common verification commands such as `npm`,
  `node`, `pytest`, `cargo`, `make`, `cmake`, `go`, `uv`, `bun`, and `deno`.
- `approval_required`: user confirmation is required before shell execution.

## Workflow

```bash
tedge drill "fix the failing add test" --fixture sample-repo-basic --providers openrouter,deepseek,mimo
tedge workflow "design and land a real multi-model orchestration workflow" --providers openrouter,deepseek,mimo --rounds 2
```

`workflow` supports 1-5 debate rounds. Later rounds are cross-examination rounds over the prior transcript. Each live batch is preflighted against `debate.max_cost_usd`.

## MCP Agent Bridge

TomorrowEdge is not replacing Claude Code / Codex. It turns them into role-bound agents inside a visible multi-model cockpit. Codex / Claude Code gives agents full access. TomorrowEdge gives full access a cockpit.

The MCP bridge lets external coding agents take roles such as `core`, `planner`, `reviewer`, `judge`, `coder_a`, and `repairer`. TomorrowEdge keeps orchestration, routing, trace, event ledger, session export, and cockpit visibility. See [docs/MCP_AGENT_BRIDGE.md](docs/MCP_AGENT_BRIDGE.md) and [docs/EXTERNAL_AGENT_ROLES.md](docs/EXTERNAL_AGENT_ROLES.md).
TomorrowEdge does not replace the Claude Code / Codex subscriptions you already have. It turns them into orchestratable and observable role nodes.

Basic usage:

```bash
tedge mcp tools
tedge mcp agents
tedge mcp agents --diagnose
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

The demo is a local bilingual Chinese/English hashed neural n-gram toy language
model with roughly 50M parameters by default, not an OpenAI or OpenRouter API
call. It exposes `/health`, `/model-info`, and `/generate`, plus a frontend with
prompt, temperature, and max token controls for orchestration acceptance drills.

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
cockpit visibility.

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
- `.env` and local `.tomorrowedge/` runtime state are git-ignored; use `npm run package:zip` for shareable archives because it excludes `.env*` and runs the secret scan
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
| Anthropic | native Messages API | no | yes, with key | text + image URL/data URL | usable |
| Gemini | native generateContent API | no | yes, with key | text + data URL images | usable |

Anthropic/Gemini now use native REST adapters. OpenRouter remains the easiest
onboarding route when you want one key for many model families, but Claude and
Gemini keys can be configured directly for high-value review, judgment, and
vision roles.

OpenRouter onboarding:

```bash
tedge models --refresh-free
tedge models --configure-free moonshotai/kimi-k2.6:free --free-first
tedge models --connection-test --provider openrouter
```

If you are not sure where to start, use OpenRouter first. One key gives
TomorrowEdge access to many model families, and the free-model refresh command
uses the live OpenRouter catalog to recommend free or low-cost large models such
as Kimi K2.6 free when available. `--configure-free` only writes the selected
model after the user chooses it. `--free-first` binds low-risk execution roles
such as explorer, coder_b, and summarizer to the selected free model.

For real work, prefer separate API keys per provider or account whenever
possible. Separate keys make cost tracking, rate-limit isolation, and provider
failure diagnosis much cleaner; do not mix a personal primary key into demo or
CI configs.

After adding a key, run `tedge models --connection-test --provider openrouter`
to verify that the configured endpoint returns HTTP 2xx from its `/models`
catalog before sending any chat prompt.

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
