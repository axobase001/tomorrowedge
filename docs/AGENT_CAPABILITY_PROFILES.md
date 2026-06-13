# Agent Capability Profiles

`AgentCapabilityProfile` is TomorrowEdge's provider-independent capability
layer.

Codex, Claude Code, DeepSeek, MiMo, Kimi, Ollama, mock, fixture, and custom
agents are examples, not hardcoded roles. Sirius routes by capability,
trust, cost, latency, allowed roles, and runtime support.

## Profile Fields

```ts
type AgentCapabilityProfile = {
  planning: number;
  architecture: number;
  coding: number;
  review: number;
  judging: number;
  repair: number;
  longContext: number;
  toolUse: number;
  patchGeneration: number;
  testGeneration: number;
  costTier: "cheap" | "medium" | "expensive";
  latencyTier: "fast" | "medium" | "slow";
  reliabilityScore: number;
  supportsMcp: boolean;
  supportsJson: boolean;
  supportsPatch: boolean;
  supportsShell: boolean;
};
```

## Configuration

Use `agent_capabilities` to override defaults without changing runtime code:

```yaml
agent_capabilities:
  deepseek:
    coding: 0.9
    patchGeneration: 0.9
    repair: 0.8
    costTier: medium
    trustLevel: medium
  mimo:
    testGeneration: 0.76
    coding: 0.68
    costTier: cheap
```

External agents can also declare capabilities:

```yaml
external_agents:
  codex:
    enabled: true
    transport: mcp
    roles: [core, planner, reviewer, judge, coder_a, repairer]
    capabilities: [core, planning, architecture, review, judgment, coding, tool_use]
```

## Routing Principle

TomorrowEdge does not pick "the best model" globally. It assigns each task node
to the best available capability under risk, budget, trust, and evidence
constraints.
