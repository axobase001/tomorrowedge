# TomorrowEdge 0.5.1 Release Notes

发布日期：2026-06-05

0.5.1 是 TomorrowEdge 第一次公开反馈后的集中修复版。这个版本不只是补
Claude/Gemini provider，而是把今晚几十个 issue / PR 里暴露出来的产品化问题
集中收口：TUI 可见性、full/partial/restricted 语义、release gate、MCP
schema、trace/export、provider fallback、workflow 执行器和本地 demo 都做了加固。

## 核心变化

- **Native Anthropic provider**：支持 Anthropic Messages API、`x-api-key`、
  `anthropic-version: 2023-06-01`、system prompt、文本和图片 URL/data URL。
- **Native Gemini provider**：支持 Gemini `generateContent`、`x-goog-api-key`、
  文本和 data URL 图片。
- **OpenRouter onboarding**：新增免费/低价模型发现、Kimi K2.6 free 优先推荐、
  一键配置 free-first routing，以及 key 配置后的连接测试。
- **深度案例文档**：新增 fixture repair loop 端到端案例，展示 plan -> patch ->
  review -> judge -> shell -> repair -> export 的完整可复盘链路。
- **Troubleshooting 文档**：覆盖 provider key、MCP agent、full mode、Windows
  中文 markdown、release zip secret scan 等常见问题。

## 今晚合并的 PR

- #82 Gate TUI approval actions by access policy
- #69 Align the 0.5 CLI surface
- #67 Harden release verify gates
- #60 Add 0.5.0 black-box contract coverage
- #58 Fix real model patch generation JSON handling
- #48 Apply v0.5 audit hardening
- #41 Clarify access modes and static cockpit fallback
- #35 Tighten MCP schemas and brief export counts

## Issue 大修摘要

### TUI / UX

- approval keys 不再绕过 access policy。
- Memory/budget/cost 面板更靠前。
- Help pane 不再浪费底部大面积空间。
- Debate pane 显示 review scores。
- Agent cards 显示耗时，并区分 patch runner / shell runner。
- Diff pane 支持查看 alternate candidates 和 repair candidates。
- Shell pane 显示真实 stdout/stderr/exit code。
- Trace pane 显示更多最近事件和事件总数。
- `tedge tui --session latest|<id>` 可以打开历史 session。

### Executor / Full Access

- full mode 保持自动 patch/shell/repair，不改语义，只强化可见性和守卫。
- executor 增加 autonomy cost / wall-time guard。
- 多步 verification plan 可以顺序执行。
- repair 后会 rerun 失败命令。
- budget status 不再被后续阶段覆盖。
- summarizer failure 不再摧毁整个 workflow result。

### Provider / Routing

- Anthropic/Gemini 从 placeholder 升级为 native provider。
- provider registry 在 fallback chat 路径中缓存，避免重复创建。
- `.env` 读取时机修复，避免 defaultConfig 在 module load 时提前吃旧 env。
- OpenRouter onboarding 推荐 free/low-cost models，并建议独立 key 以隔离成本和限额。
- `tedge models --connection-test` 可以在真实 chat 前检查 `/models` 是否返回 HTTP 2xx。

### Patch / Shell / Export

- patch parser/applier 支持 create/delete patches。
- shellGuard 支持 backslash escaping。
- workflow markdown report 使用 UTF-8 BOM，减少 Windows 中文乱码。
- MCP markdown export 展开 patch diff、review/judge、shell output artifact。
- `trace latest --verbose` 显示 artifact refs。

### MCP / External Agents

- MCP tool schemas 更严格，减少 role-bound external agent 提交无结构结果。
- export brief 统计 stored artifact count，而不是重复 artifact refs。
- external agent bridge 的 CLI surface 和 mock/stdin 测试更完整。

### Release / CI

- `npm run verify` 覆盖 test、build、secrets scan、audit、pack dry-run。
- CI 增加 `npm run secrets:scan`。
- pack dry-run 会拒绝未跟踪但会进入 npm package 的文件。
- 0.5.1 已同步 package metadata、README、CHANGELOG、tag 和 GitHub Release。

## 关闭的问题分组

- Access/TUI approval：#74, #71, #38, #27
- TUI visibility/layout：#79, #78, #77, #76, #75, #73, #70, #68, #52, #39
- Executor/verification/repair：#81, #80, #62, #61, #43
- Provider/routing/json/env：#66, #65, #64, #49, #46, #42, #21, #20, #18
- Patch/shell/report：#63, #45, #44, #40, #34
- MCP/export/trace/coverage：#57, #56, #55, #54, #53, #51, #50, #32, #31
- Release/package/audit：#47, #37, #36, #33

## 验证

```bash
npm run verify
```

通过内容：

- 26 个 test files
- 134 个 tests
- TypeScript build
- secrets scan
- high-severity audit
- dry npm pack

打包产物：`tomorrowedge-0.5.1.tgz`
