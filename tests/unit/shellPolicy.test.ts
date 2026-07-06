import { describe, expect, it } from "vitest";
import { assessShellCommand, parseShellCommand } from "../../src/safety/shellGuard.js";
import { runApprovedCommand } from "../../src/core/tools/shellTool.js";
import { effectiveShellPolicy } from "../../src/core/tools/shellPolicy.js";

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

  it("defaults approved shell execution to the verification allowlist", async () => {
    expect(effectiveShellPolicy(undefined)).toBe("verification_allowlist");
    await expect(runApprovedCommand(process.cwd(), "git --version", { approved: true })).rejects.toThrow(/safe verification allowlist/);
    await expect(runApprovedCommand(process.cwd(), "curl --version", { approved: true })).rejects.toThrow(/dangerous executable blocked/);
  });

  it("allows explicit unrestricted shell policy as an opt-in", async () => {
    const result = await runApprovedCommand(process.cwd(), "git --version", { approved: true, policy: "unrestricted" });

    expect(result.success).toBe(true);
    expect(result.stdout).toContain("git version");
  });
});
