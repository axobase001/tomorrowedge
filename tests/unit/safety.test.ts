import { describe, expect, it } from "vitest";
import { canSendToCloud } from "../../src/safety/privacyGuard.js";
import { redactText, scanSecrets } from "../../src/safety/secretScanner.js";
import { classifyProviderError, formatProviderError, redactProviderError, redactSessionRecord } from "../../src/safety/providerRedaction.js";
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

  it("redacts provider account identifiers from raw error metadata", () => {
    const content = 'openrouter request failed: 429 {"error":{"metadata":{"provider_name":"Crucible"}},"user_id":"user_3EfqcfPXAjQTwahh8KSxAxJJYP9","accountId":"acct_live_123"}';
    const redacted = redactText(content);

    expect(redacted).not.toContain("user_3EfqcfPXAjQTwahh8KSxAxJJYP9");
    expect(redacted).not.toContain("acct_live_123");
    expect(redacted).toContain("provider_name");
  });

  it("classifies provider errors into actionable categories", () => {
    expect(classifyProviderError("provider failed: 429 too many requests")).toBe("rate_limited");
    expect(classifyProviderError("insufficient quota; please add credits")).toBe("quota_exhausted");
    expect(classifyProviderError("401 invalid api key")).toBe("invalid_key");
    expect(classifyProviderError("404 invalid model")).toBe("invalid_model");
    expect(classifyProviderError("503 upstream unavailable")).toBe("upstream_unavailable");
  });

  it("formats redacted provider errors without account identifiers", () => {
    const report = redactProviderError(new Error('429 {"user_id":"user_3EfqcfPXAjQTwahh8KSxAxJJYP9","accountId":"acct_live_123"}'));
    const formatted = formatProviderError(report);

    expect(report.category).toBe("rate_limited");
    expect(formatted).not.toContain("user_3EfqcfPXAjQTwahh8KSxAxJJYP9");
    expect(formatted).not.toContain("acct_live_123");
    expect(formatted).toContain("[redacted]");
  });

  it("redacts nested session records before persistence or API return", () => {
    const record = redactSessionRecord({
      state: {
        events: [{ error: "Bearer abcdefghijklmnopqrstuvwxyz123456" }],
        eventArtifacts: [{ content: "OPENAI_API_KEY=sk-123456789012345678901234" }]
      }
    });

    expect(JSON.stringify(record)).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(JSON.stringify(record)).not.toContain("sk-");
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
