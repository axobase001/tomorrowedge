# TomorrowEdge 0.5.2 Release Notes

发布日期：2026-06-05

0.5.2 是一次试用体验收口版。这个版本没有继续堆大系统，而是把入口、
文档、MCP 状态、shell 语义和 external role fallback 可见性整理清楚。

## 核心变化

- README 和 GitHub Pages 增加 **3-minute tryout**：无需 API key，直接跑
  offline fixture workflow、verification、trace 和 TUI。
- MCP Agent Bridge 增加真实接入状态表：
  - Codex CLI：experimental，支持 `codex mcp-server`
  - Claude Code：wrapper required，取决于本地 stdio wrapper
  - Mock external agent：stable，用于测试
  - Custom MCP agent：experimental
- `shell.policy` 文档更清楚：`unrestricted` 是 unrestricted executable
  invocation，仍然使用 `shell: false`，不是 raw shell script execution。
- Roadmap 改成清晰的 0.5.x / 0.6.x / 0.7.x 节奏。
- External role payload 无法 normalize 时，会写入 `external_agent_error`
  再 fallback 到 native agent，不再静默 fallback。
- Codex MCP newline framing 增强 Windows 兼容：识别 `codex.cmd`、
  `codex.exe`、`codex.ps1`。

## 验证

```bash
npm run verify
```

通过内容：

- 26 个 test files
- 139 个 tests
- TypeScript build
- secrets scan
- high-severity audit
- dry npm pack

打包产物：`tomorrowedge-0.5.2.tgz`
