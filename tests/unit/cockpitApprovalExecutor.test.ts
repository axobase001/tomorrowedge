import { describe, expect, it } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeCockpitApprovalAction } from "../../src/cockpit/approvalExecutor.js";
import { writeConfig } from "../../src/config/configLoader.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";

describe("cockpit approval executor", () => {
  it("uses the verification allowlist for full-mode shell approvals by default", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-shell-policy-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    try {
      await writeConfig(cwd, {
        ...defaultConfig,
        shell: {
          policy: undefined,
          verification_allowlist: ["npm"]
        }
      });
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
      const pendingShell = {
        ...state,
        access: { ...state.access, mode: "full" as const, shellAllowed: true, shellApproved: true },
        changedFiles: ["index.js"],
        plan: state.plan ? { ...state.plan, verificationCommands: ["node test.js"] } : state.plan,
        approvals: { ...state.approvals, patchApproved: true, shellApproved: false }
      };

      const result = await executeCockpitApprovalAction(cwd, pendingShell, {
        action: "approve_shell",
        sessionId: state.sessionId,
        approvalId: "shell:test"
      });

      expect(result.status).toBe("blocked");
      expect(result.message).toContain("safe verification allowlist");
      expect(result.state.approvals.shellApproved).toBe(false);
      expect(result.state.events).toContainEqual(expect.objectContaining({
        type: "shell_run",
        command: "node test.js",
        error: expect.stringContaining("safe verification allowlist")
      }));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
