import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { createEventLedger } from "../../src/core/events/eventLedger.js";
import { parseScenarioProfile, profileScenarioWithModel } from "../../src/core/scenarios/modelScenarioProfiler.js";
import { ModelRouter } from "../../src/core/routing/router.js";

describe("model scenario profiler", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("repairs truncated profile JSON through the same planner model", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      const content = bodies.length === 1
        ? '{"scenarioType":"document","userIntent":"create assignment","expectedDeliverable":"truncated'
        : JSON.stringify({
            scenarioType: "document",
            userIntent: "Create a Chinese math assignment project.",
            expectedDeliverable: "Markdown, HTML, SVG, README, optional PDF.",
            ambiguityLevel: "low",
            likelyWorkflowKind: "patch",
            riskSignals: ["correctness_critical"],
            evidenceNeeds: ["target files exist", "HTML openable", "SVG readable"],
            suggestedRoles: ["planner", "coder_a", "reviewer", "judge"]
          });
      return new Response(JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openrouter: {
          ...defaultConfig.providers.openrouter,
          enabled: true,
          api_key_env: "",
          auth_header: "none",
          base_url: "https://openrouter.test/api/v1",
          model: "z-ai/glm-5.1"
        }
      },
      agents: {
        ...defaultConfig.agents,
        planner: { provider: "openrouter", model: "z-ai/glm-5.1" }
      },
      routing: { ...defaultConfig.routing, fallback: false }
    };
    const ledger = createEventLedger("full");
    const result = await profileScenarioWithModel({
      goal: "Create a Chinese math assignment project.",
      workflowIntent: { intent: "patch", requiresPatchWorkflow: true, workflowKind: "patch" },
      accessMode: "full",
      config,
      router: new ModelRouter(config),
      ledger
    });

    expect(result.profile?.scenarioType).toBe("document");
    expect(result.profile?.likelyWorkflowKind).toBe("patch");
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1]?.messages)).toContain("Repair TomorrowEdge scenario profiler output");
    expect(ledger.events).toContainEqual(expect.objectContaining({
      type: "evidence_update",
      role: "planner",
      evidence: expect.arrayContaining([expect.stringMatching(/scenario profile invalid/i)])
    }));
  });

  it("accepts string evidence needs from models", () => {
    const profile = parseScenarioProfile(JSON.stringify({
      scenarioType: "coding",
      userIntent: "Create files",
      expectedDeliverable: "Generated files",
      ambiguityLevel: "low",
      likelyWorkflowKind: "patch",
      riskSignals: [],
      evidenceNeeds: "file existence, HTML openable, SVG readable",
      suggestedRoles: ["planner", "coder_a", "reviewer"]
    }));

    expect(profile?.evidenceNeeds).toEqual(["file existence", "HTML openable", "SVG readable"]);
  });
});
