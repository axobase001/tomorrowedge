import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runAgentDrill } from "../../src/core/eval/agentDrill.js";

describe("agent capability drill", () => {
  it("runs a non-mutating mock drill with local reviewer scores", async () => {
    const result = await runAgentDrill(process.cwd(), "fix failing test", defaultConfig, {
      providers: ["mock"],
      includeMock: true
    });

    expect(result.task).toBe("fix failing test");
    expect(result.planner.expectedFiles).toEqual(["index.js"]);
    expect(result.runs[0]?.provider).toBe("mock");
    expect(result.runs[0]?.score).toBeGreaterThanOrEqual(0);
  });
});
