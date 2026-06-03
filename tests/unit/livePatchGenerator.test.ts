import { describe, expect, it } from "vitest";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { PlannerAgent } from "../../src/core/agents/planner.js";
import { ExplorerAgent } from "../../src/core/agents/explorer.js";
import { buildLivePatchPlans } from "../../src/core/model/livePatchGenerator.js";
import { ModelRouter } from "../../src/core/routing/router.js";

describe("live patch generator", () => {
  it("omits file contents when cloud repo context is disabled", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      privacy: { ...defaultConfig.privacy, allow_cloud_repo_context: false }
    };
    const router = new ModelRouter(config);
    const planner = new PlannerAgent();
    const plan = await planner.run({ goal: "fix failing test" });
    const explorer = new ExplorerAgent();
    const contextSelection = await explorer.run({ plan }, { cwd, router });
    const plans = await buildLivePatchPlans({ cwd, goal: "fix failing test", config, router, plan, contextSelection });

    expect(plans[0].prompt).toContain("CONTENT: omitted");
    expect(plans[0].prompt).not.toContain("return a - b");
  });
});
