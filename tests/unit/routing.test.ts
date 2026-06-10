import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { defaultOrchestrationPolicy } from "../../src/core/orchestrationPolicy/orchestrationPolicy.js";
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
        openrouter: { ...defaultConfig.providers.openrouter, enabled: true, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" },
        deepseek: { ...defaultConfig.providers.deepseek, enabled: true, api_key_env: "DEEPSEEK_API_KEY", base_url: "https://api.deepseek.com" }
      }
    };
    const router = new ModelRouter(config);

    expect(router.assignmentFor("planner").provider).toBe("openrouter");
    expect(router.assignmentFor("judge").provider).toBe("openrouter");
    expect(router.assignmentFor("coder_a").provider).toBe("deepseek");
    expect(router.assignmentFor("repairer").provider).toBe("deepseek");
  });

  it("applies selected policy routing preference before role execution", () => {
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      routing: { ...defaultConfig.routing, mode: "balanced" },
      providers: {
        ...defaultConfig.providers,
        openrouter: { ...defaultConfig.providers.openrouter, enabled: true, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" },
        deepseek: { ...defaultConfig.providers.deepseek, enabled: true, api_key_env: "DEEPSEEK_API_KEY", base_url: "https://api.deepseek.com" }
      }
    };
    const router = new ModelRouter(config);
    const policy = {
      ...defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z"),
      routingPolicy: { ...defaultOrchestrationPolicy().routingPolicy, routingPreference: "cheap" as const }
    };

    const before = router.assignmentFor("planner");
    const changes = router.applyPolicyRoutingPreference(policy);

    expect(before.provider).toBe("openrouter");
    expect(changes.length).toBeGreaterThan(0);
    expect(router.assignmentFor("planner").provider).toBe("deepseek");
    expect(changes.some((change) => change.role === "planner" && change.reason.includes("routingPreference=cheap"))).toBe(true);
  });

  it("keeps privacy locks and explicit role overrides across policy routing", () => {
    const privacyRouter = new ModelRouter({
      ...defaultConfig,
      routing: { ...defaultConfig.routing, mode: "privacy" },
      providers: {
        ...defaultConfig.providers,
        openrouter: { ...defaultConfig.providers.openrouter, enabled: true, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" }
      }
    });
    const qualityPolicy = {
      ...defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z"),
      routingPolicy: { ...defaultOrchestrationPolicy().routingPolicy, routingPreference: "quality" as const }
    };

    expect(privacyRouter.applyPolicyRoutingPreference(qualityPolicy)).toEqual([]);
    expect(privacyRouter.assignmentFor("planner").provider).toBe("ollama");

    const overrideRouter = new ModelRouter({
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openrouter: { ...defaultConfig.providers.openrouter, enabled: true, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" },
        deepseek: { ...defaultConfig.providers.deepseek, enabled: true, api_key_env: "DEEPSEEK_API_KEY", base_url: "https://api.deepseek.com" }
      },
      agents: {
        ...defaultConfig.agents,
        planner: { provider: "openrouter", model: "openai/gpt-5.2" }
      }
    });
    const cheapPolicy = {
      ...qualityPolicy,
      routingPolicy: { ...qualityPolicy.routingPolicy, routingPreference: "cheap" as const }
    };

    overrideRouter.applyPolicyRoutingPreference(cheapPolicy);

    expect(overrideRouter.assignmentFor("planner")).toMatchObject({ provider: "openrouter", model: "openai/gpt-5.2" });
  });

  it("routes visual perception to a vision-capable model when available", () => {
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        mimo: { ...defaultConfig.providers.mimo, enabled: true, api_key_env: "MIMO_API_KEY", base_url: "https://token-plan-sgp.xiaomimimo.com/v1" },
        deepseek: { ...defaultConfig.providers.deepseek, enabled: true, api_key_env: "DEEPSEEK_API_KEY", base_url: "https://api.deepseek.com" }
      }
    };
    const router = new ModelRouter(config);

    expect(router.assignmentFor("vision").provider).toBe("mimo");
    expect(router.assignmentFor("vision").reason).toContain("image input");
  });

  it("keeps vision local in privacy mode even when cloud vision is enabled", () => {
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      routing: { ...defaultConfig.routing, mode: "privacy" },
      providers: {
        ...defaultConfig.providers,
        mimo: { ...defaultConfig.providers.mimo, enabled: true, api_key_env: "MIMO_API_KEY", base_url: "https://token-plan-sgp.xiaomimimo.com/v1" }
      }
    };
    const router = new ModelRouter(config);

    expect(router.getPlan().privacyLocked).toBe(true);
    expect(router.assignmentFor("vision").provider).toBe("ollama");
  });

  it("honors user-configured provider and model per role", () => {
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openrouter: { ...defaultConfig.providers.openrouter, enabled: true, model: "anthropic/claude-opus-4.1" },
        deepseek: { ...defaultConfig.providers.deepseek, enabled: true, base_url: "https://api.deepseek.com", model: "deepseek-chat" }
      },
      agents: {
        ...defaultConfig.agents,
        planner: { provider: "deepseek", model: "deepseek-chat" },
        reviewer: { provider: "openrouter", model: "anthropic/claude-opus-4.1" }
      }
    };
    const router = new ModelRouter(config);

    expect(router.assignmentFor("planner")).toMatchObject({ provider: "deepseek", model: "deepseek-chat" });
    expect(router.assignmentFor("reviewer")).toMatchObject({ provider: "openrouter", model: "anthropic/claude-opus-4.1" });
  });

  it("routes user-configured roles to custom OpenAI-compatible gateway providers", () => {
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        oneapi_gateway: {
          enabled: true,
          api_key_env: "ONEAPI_GATEWAY_KEY",
          base_url: "https://oneapi.example/v1",
          model: "gpt-4o-mini",
          api_format: "openai_chat",
          auth_header: "bearer",
          extra_headers: {}
        }
      },
      agents: {
        ...defaultConfig.agents,
        planner: { provider: "oneapi_gateway", model: "gpt-4o-mini" }
      }
    };
    const router = new ModelRouter(config);

    expect(router.assignmentFor("planner")).toMatchObject({ provider: "oneapi_gateway", model: "gpt-4o-mini" });
  });

  it("keeps privacy/local routing local even when a role override points to cloud", () => {
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      routing: { ...defaultConfig.routing, mode: "privacy" },
      providers: {
        ...defaultConfig.providers,
        openrouter: { ...defaultConfig.providers.openrouter, enabled: true, model: "openai/gpt-5.2" }
      },
      agents: {
        ...defaultConfig.agents,
        planner: { provider: "openrouter", model: "openai/gpt-5.2" }
      }
    };
    const router = new ModelRouter(config);

    expect(router.assignmentFor("planner").provider).toBe("ollama");
    expect(router.assignmentFor("planner").reason).toContain("ignored cloud override");
  });
});
