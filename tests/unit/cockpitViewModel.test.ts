import { describe, expect, it } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { buildCockpitViewModel } from "../../src/cockpit/viewModel.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";

describe("cockpit view model", () => {
  it("projects an offline run into four-zone cockpit sections", async () => {
    const state = await runOfflineGraph(process.cwd(), "fix failing test", defaultConfig, { fixtureMode: true });
    const vm = buildCockpitViewModel(process.cwd(), state);

    expect(vm.version).toBe("1");
    expect(vm.workflow.map((step) => step.label)).toEqual(["Plan", "Route", "Edit", "Review", "Test", "Judge", "Approve"]);
    expect(vm.tasks[0]?.selected).toBe(true);
    expect(vm.telemetry.dispatched).toBeGreaterThan(0);
    expect(vm.telemetry.providerSummary).toBeTruthy();
    expect(vm.trace.length).toBeGreaterThan(0);
  });

  it("switches the main view to approval when a candidate waits for authorization", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-vm-approval-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
      const vm = buildCockpitViewModel(cwd, state);

      expect(vm.status).toBe("waiting_approval");
      expect(vm.currentApproval?.kind).toBe("patch");
      expect(vm.main.title).toContain("approval");
      expect(vm.main.diff).toContain("return a + b");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
