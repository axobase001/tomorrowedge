import { describe, expect, it } from "vitest";
import { assessShellCommand, explainShellCommand, parseShellCommand } from "../../src/safety/shellGuard.js";
import { assessPatchAction, assessShellAction } from "../../src/safety/actionRisk.js";
import { runApprovedCommand } from "../../src/core/tools/shellTool.js";

describe("shell policy", () => {
  it("keeps verification allowlist separate from unrestricted parsing", () => {
    expect(assessShellCommand("git status").allowed).toBe(false);
    expect(parseShellCommand("git status")).toMatchObject({ allowed: true, argv: ["git", "status"] });
    expect(parseShellCommand("node path\\ with\\ spaces.js")).toMatchObject({ allowed: true, argv: ["node", "path with spaces.js"] });
    expect(parseShellCommand('node "quoted \\"name\\".js"')).toMatchObject({ allowed: true, argv: ["node", 'quoted "name".js'] });
    expect(assessShellCommand("cargo test").allowed).toBe(true);
    expect(assessShellCommand("bun test").allowed).toBe(true);
    expect(parseShellCommand("git status; rm -rf .").allowed).toBe(false);
  });

  it("requires approval before any shell policy can run", async () => {
    await expect(runApprovedCommand(process.cwd(), "node --version", { approved: false, policy: "unrestricted" })).rejects.toThrow("approval required");
  });

  it("blocks dangerous executables even without the verification allowlist", async () => {
    expect(explainShellCommand("rm package.json", undefined, false)).toMatchObject({ allowed: false, dangerous: true });
    await expect(runApprovedCommand(process.cwd(), "rm package.json", { approved: true, policy: "unrestricted" })).rejects.toThrow("dangerous executable blocked");
  });

  it("classifies dangerous shell and sensitive patch targets", () => {
    expect(assessShellAction("rm package.json").riskLevel).toBe("high");
    expect(assessShellAction("rm package.json", { policy: "unrestricted" }).blocked).toBe(true);
    const patch = "--- a/.env\n+++ b/.env\n@@ -1,1 +1,1 @@\n-API_KEY=old\n+API_KEY=new\n";
    const assessed = assessPatchAction(process.cwd(), patch);

    expect(assessed.riskLevel).toBe("high");
    expect(assessed.blocked).toBe(true);
    expect(assessed.explanation).toContain("Sensitive targets");
  });
});
