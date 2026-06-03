import { describe, expect, it } from "vitest";
import { canSendToCloud } from "../../src/safety/privacyGuard.js";
import { redactText, scanSecrets } from "../../src/safety/secretScanner.js";
import { assessShellCommand } from "../../src/safety/shellGuard.js";
import { createEventLedger } from "../../src/core/events/eventLedger.js";

describe("safety", () => {
  it("detects secret-like assignments", () => {
    expect(scanSecrets("OPENAI_API_KEY=sk-test").length).toBe(1);
  });

  it("detects common provider tokens and redacts text", () => {
    const content = "GITHUB_TOKEN=ghp_123456789012345678901234567890123456 npm_token=npm_123456789012345678901234567890";
    expect(scanSecrets(content).map((finding) => finding.kind)).toContain("github_token");
    expect(redactText(content)).not.toContain("ghp_");
    expect(redactText(content)).not.toContain("npm_123");
  });

  it("blocks raw cloud context in privacy mode", () => {
    const decision = canSendToCloud("normal code", "privacy");
    expect(decision.allowed).toBe(false);
  });

  it("blocks shell metacharacters and dangerous executables", () => {
    expect(assessShellCommand("npm test").allowed).toBe(true);
    expect(assessShellCommand("npm test; rm -rf .").allowed).toBe(false);
    expect(assessShellCommand("rm -rf dist").allowed).toBe(false);
  });

  it("redacts event ledger artifacts and event payloads", () => {
    const ledger = createEventLedger("partial", "session_test");
    const ref = ledger.writeArtifact("stdout", "OPENAI_API_KEY=sk-123456789012345678901234");
    ledger.append({
      type: "evidence_update",
      phase: "summary",
      evidence: ["Bearer abcdefghijklmnopqrstuvwxyz123456"]
    });

    expect(ledger.artifacts.find((artifact) => artifact.ref === ref)?.content).not.toContain("sk-");
    expect(JSON.stringify(ledger.events)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});
