import { describe, expect, it, afterEach } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { createEventLedger } from "../../src/core/events/eventLedger.js";
import { createModelBackedPlan, parsePlannerResponseWithDiagnostics } from "../../src/core/goal/modelPlanner.js";
import { ModelRouter } from "../../src/core/routing/router.js";

describe("model planner", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports truncated planner JSON as a structured parse error", () => {
    const result = parsePlannerResponseWithDiagnostics("create files", '{"taskType":"feature","riskLevel":"medium","steps":[{"id":"1","title":"Plan","detail":"');

    expect(result.plan).toBeUndefined();
    expect(result.error).toMatch(/Unterminated string|JSON/i);
  });

  it("repairs invalid planner JSON through the same configured model instead of native fallback", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      const content = bodies.length === 1
        ? '{"taskType":"feature","riskLevel":"medium","workflowKind":"patch","steps":[{"id":"1","title":"Plan","detail":"truncated'
        : JSON.stringify({
            taskType: "feature",
            riskLevel: "medium",
            workflowKind: "patch",
            constraints: ["only touch target directory"],
            steps: [
              { id: "inspect_context", title: "Inspect target", detail: "Check the requested target directory and constraints." },
              { id: "design_patch", title: "Design patch", detail: "Plan the files and verification path." },
              { id: "produce_patch", title: "Produce patch", detail: "Create the requested files." },
              { id: "verify_patch", title: "Verify patch", detail: "Check target files only." }
            ],
            taskGraph: null,
            verificationCommands: ["node .tomorrowedge/verify-target.cjs"],
            debateRecommended: false,
            reasonForDebate: ""
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
    const result = await createModelBackedPlan({
      goal: "create a math assignment under assignments/sine-integral-residue",
      config,
      router: new ModelRouter(config),
      ledger
    });

    expect(result.plan?.taskType).toBe("feature");
    expect(result.plan?.taskGraph?.nodes.length).toBeGreaterThan(0);
    expect(result.fallbackUsed).toBe(false);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      reasoning: { effort: "none", exclude: true },
      reasoning_effort: "none"
    });
    expect(JSON.stringify(bodies[1]?.messages)).toContain("repair TomorrowEdge planner output");
    expect(ledger.events).toContainEqual(expect.objectContaining({
      type: "evidence_update",
      role: "planner",
      evidence: expect.arrayContaining([expect.stringMatching(/planner output invalid/i)])
    }));
  });
});
