# MCP Adapters

MCP support is planned as a tool adapter layer, not as a top-level orchestration
backend.

The top-level backend remains one of:

```yaml
orchestration:
  backend: native # native | langgraph | crewai | autogen
```

MCP tools are then exposed under the selected backend when explicitly enabled:

```yaml
orchestration:
  mcp_tools:
    enabled: true
    servers:
      - filesystem
      - github
    exposeToolsToBackend: false
```

`exposeToolsToBackend` defaults to `false` because tool access is part of the
full-access trust boundary. A backend must not receive broad tool authority
without explicit configuration and event logging.

## Adapter Contract

An MCP adapter should:

- discover configured MCP servers
- expose a narrow tool manifest to the selected backend
- translate every tool call into TomorrowEdge events
- preserve access-mode decisions before a tool mutates the workspace
- attach stdout/stderr, patches, and files as artifacts, not opaque text blobs

## Non-Goals For 0.1.1

- No automatic MCP server discovery.
- No hidden tool elevation.
- No framework-owned approval flow.

MCP expands tool reach. TomorrowEdge still owns approval, audit, and replay.

