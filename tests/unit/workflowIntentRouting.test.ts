import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { createEventLedger } from "../../src/core/events/eventLedger.js";
import { classifyWorkflowIntent } from "../../src/core/goal/workflowIntent.js";
import { ModelRouter } from "../../src/core/routing/router.js";

describe("workflow intent routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["list files and summarize structure", "read_only", false],
    ["\u8bfb\u53d6 quantum \u6587\u4ef6\u5939\u5185\u5bb9\uff0c\u8f93\u51fa\u6587\u4ef6\u7ed3\u6784", "read_only", false],
    ["fix failing test", "patch", true],
    ["implement OAuth login", "patch", true],
    ["review architecture and suggest improvements, do not edit", "read_only", false],
    ["generate UI from screenshot", "vision_patch", true]
  ] as const)("routes %s through a model semantic classifier", async (goal, workflowKind, requiresPatchWorkflow) => {
    const ledger = createEventLedger("partial");
    const decision = await classifyWorkflowIntent({
      goal,
      config: defaultConfig,
      router: new ModelRouter(defaultConfig),
      ledger,
      fixtureMode: true
    });

    expect(decision.workflowKind).toBe(workflowKind);
    expect(decision.requiresPatchWorkflow).toBe(requiresPatchWorkflow);
    expect(decision.provider).toBe("mock");
    expect(ledger.events).toContainEqual(expect.objectContaining({
      type: "model_call",
      provider: "mock",
      model: "mock-balanced"
    }));
  });

  it("treats Chinese file creation with read-only constraints as a patch workflow via the model route", async () => {
    const ledger = createEventLedger("partial");
    const goal = "\u521b\u5efa assignments/finite-division-ring-field/proof.md \u548c proof.html\uff0c\u4e0d\u662f\u53ea\u8bfb\u5206\u6790\uff0c\u4e0d\u8981\u4fee\u6539\u5176\u4ed6\u6587\u4ef6\uff0c\u5fc5\u987b\u751f\u6210 patch";
    const decision = await classifyWorkflowIntent({
      goal,
      config: defaultConfig,
      router: new ModelRouter(defaultConfig),
      ledger,
      fixtureMode: true
    });

    expect(decision.workflowKind).toBe("patch");
    expect(decision.requiresPatchWorkflow).toBe(true);
    expect(decision.reason).toContain("Mock intent model");
    expect(ledger.events.some((event) => event.type === "model_call" && event.provider === "mock")).toBe(true);
  });

  it("uses json_schema and retries once when a real intent model returns invalid JSON", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const content = bodies.length === 1
        ? "not json"
        : JSON.stringify({
            intent: "inspect",
            requiresPatchWorkflow: false,
            workflowKind: "read_only",
            confidence: 0.9,
            reason: "Same-model repair produced valid structured intent."
          });
      return new Response(JSON.stringify({ id: `intent-${bodies.length}`, choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openai_compatible: {
          ...defaultConfig.providers.openai_compatible,
          enabled: true,
          auth_header: "none",
          base_url: "https://gateway.example/v1",
          model: "structured-model"
        }
      },
      agents: {
        ...defaultConfig.agents,
        planner: { provider: "openai_compatible", model: "structured-model" }
      }
    };
    const ledger = createEventLedger("partial");
    const decision = await classifyWorkflowIntent({
      goal: "read the project structure",
      config,
      router: new ModelRouter(config),
      ledger
    });

    expect(decision.workflowKind).toBe("read_only");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.response_format).toMatchObject({ type: "json_schema" });
    expect(JSON.stringify(bodies[1]?.messages)).toContain("Invalid previous output");
    expect(ledger.events.filter((event) => event.type === "model_call" && event.provider === "openai_compatible")).toHaveLength(4);
  });

  it("does not force response_format for custom OpenAI-compatible providers", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        id: "custom-intent",
        choices: [{
          message: {
            content: JSON.stringify({
              intent: "inspect",
              requiresPatchWorkflow: false,
              workflowKind: "read_only",
              confidence: 0.86,
              reason: "Custom provider returned strict JSON without response_format."
            })
          }
        }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        volcengine_ark: {
          enabled: true,
          auth_header: "none",
          base_url: "https://ark.example/api/plan/v3",
          model: "glm-5.2",
          models: [{ id: "glm-5.2", label: "GLM-5.2" }],
          api_format: "openai_chat",
          extra_headers: {},
          requestTimeoutMs: 60_000,
          maxRetries: 1,
          retryBaseDelayMs: 1000
        }
      },
      agents: {
        ...defaultConfig.agents,
        planner: { provider: "volcengine_ark", model: "glm-5.2" }
      }
    };
    const ledger = createEventLedger("partial");
    const decision = await classifyWorkflowIntent({
      goal: "summarize the project",
      config,
      router: new ModelRouter(config),
      ledger
    });

    expect(decision.workflowKind).toBe("read_only");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.response_format).toBeUndefined();
  });
});
