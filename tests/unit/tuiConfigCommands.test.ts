import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config/configLoader.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { loadProjectPreferences } from "../../src/core/memory/preferences.js";
import { applyTuiConfigCommand, parseTuiConfigCommand } from "../../src/tui/state/configCommands.js";

describe("TUI config commands", () => {
  it("persists access mode from the TUI command path", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-tui-config-"));
    try {
      const graph = await runOfflineGraph(cwd, "configure from tui", defaultConfig);
      const command = parseTuiConfigCommand("/mode full");
      expect(command).toEqual({ kind: "mode", mode: "full" });

      const result = await applyTuiConfigCommand(cwd, graph, command!);

      expect(result.graph.access.mode).toBe("full");
      expect(loadConfig(cwd).project.access_mode).toBe("full");
      expect(loadProjectPreferences(cwd).accessMode).toBe("full");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("persists role model overrides, routing mode, and preferred test command", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-tui-config-"));
    try {
      const graph = await runOfflineGraph(cwd, "configure routing from tui", defaultConfig);
      const model = await applyTuiConfigCommand(cwd, graph, parseTuiConfigCommand("/model planner openrouter openai/gpt-5.2")!);
      const routing = await applyTuiConfigCommand(cwd, model.graph, parseTuiConfigCommand("/routing quality")!);
      const testCommand = await applyTuiConfigCommand(cwd, routing.graph, parseTuiConfigCommand("/test-command npm run verify")!);

      expect(model.graph.routing.assignments.find((assignment) => assignment.role === "planner")).toMatchObject({
        provider: "openrouter",
        model: "openai/gpt-5.2"
      });
      expect(testCommand.message).toContain("npm run verify");
      expect(loadConfig(cwd).agents.planner).toEqual({ provider: "openrouter", model: "openai/gpt-5.2" });
      expect(loadConfig(cwd).routing.mode).toBe("quality");
      expect(loadProjectPreferences(cwd)).toMatchObject({
        routingMode: "quality",
        preferredTestCommand: "npm run verify"
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("persists current route preview as agent overrides", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-tui-config-"));
    try {
      const graph = await runOfflineGraph(cwd, "configure route override from tui", defaultConfig);
      const preview = {
        ...graph,
        routing: {
          ...graph.routing,
          assignments: graph.routing.assignments.map((assignment) =>
            assignment.role === "planner"
              ? { ...assignment, provider: "openrouter", model: "openai/gpt-5.2", reason: "test preview" }
              : assignment
          )
        }
      };

      const result = await applyTuiConfigCommand(cwd, preview, parseTuiConfigCommand("/save-route")!);

      expect(result.message).toContain("Saved current TUI route");
      expect(loadConfig(cwd).agents.planner).toEqual({ provider: "openrouter", model: "openai/gpt-5.2" });
      expect(result.graph.routing.assignments.find((assignment) => assignment.role === "planner")?.provider).toBe("openrouter");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
