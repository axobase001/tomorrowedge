import { describe, expect, it } from "vitest";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { NativeBackend } from "../../src/core/orchestration/nativeBackend.js";
import { createOrchestrationBackend } from "../../src/core/orchestration/registry.js";

describe("orchestration backends", () => {
  it("wraps the native graph and exposes events as an async iterable", async () => {
    const backend = new NativeBackend();
    backend.load(defaultConfig);
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const events = [];

    for await (const event of backend.run({ cwd, goal: "fix failing test" })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === "access_mode")).toBe(true);
    expect(events.some((event) => event.type === "summary")).toBe(true);
    expect(backend.getLastState()?.goal).toBe("fix failing test");
  });

  it("registers placeholder adapters with clear unavailable errors", async () => {
    const backend = createOrchestrationBackend({
      ...defaultConfig,
      orchestration: { ...defaultConfig.orchestration, backend: "langgraph" }
    });

    await expect(async () => {
      for await (const _event of backend.run({ cwd: process.cwd(), goal: "test placeholder" })) {
        // Placeholder should throw before yielding.
      }
    }).rejects.toThrow('Orchestration backend "langgraph" is not executable');
  });
});

