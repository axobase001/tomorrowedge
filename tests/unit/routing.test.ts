import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { ModelRouter } from "../../src/core/routing/router.js";
import { buildRoutingPlan } from "../../src/core/routing/policies.js";

describe("routing policies", () => {
  it("builds visible role assignments", () => {
    const plan = buildRoutingPlan("balanced");
    expect(plan.assignments.find((assignment) => assignment.role === "vision")).toBeTruthy();
    expect(plan.assignments.find((assignment) => assignment.role === "planner")).toBeTruthy();
    expect(plan.assignments.find((assignment) => assignment.role === "runner")?.provider).toBe("local_tool");
  });

  it("locks privacy for privacy mode", () => {
    expect(buildRoutingPlan("privacy").privacyLocked).toBe(true);
  });

  it("routes enabled real providers by role", () => {
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openrouter: { enabled: true, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" },
        deepseek: { enabled: true, api_key_env: "DEEPSEEK_API_KEY", base_url: "https://api.deepseek.com" }
      }
    };
    const router = new ModelRouter(config);

    expect(router.assignmentFor("planner").provider).toBe("openrouter");
    expect(router.assignmentFor("judge").provider).toBe("openrouter");
    expect(router.assignmentFor("coder_a").provider).toBe("deepseek");
    expect(router.assignmentFor("repairer").provider).toBe("deepseek");
  });

  it("routes visual perception to a vision-capable model when available", () => {
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        mimo: { enabled: true, api_key_env: "MIMO_API_KEY", base_url: "https://token-plan-sgp.xiaomimimo.com/v1" },
        deepseek: { enabled: true, api_key_env: "DEEPSEEK_API_KEY", base_url: "https://api.deepseek.com" }
      }
    };
    const router = new ModelRouter(config);

    expect(router.assignmentFor("vision").provider).toBe("mimo");
    expect(router.assignmentFor("vision").reason).toContain("image input");
  });
});
