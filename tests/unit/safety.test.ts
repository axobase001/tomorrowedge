import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { classifyFileRisk, isBinaryLikePath } from "../../src/safety/fileRisk.js";
import { createIgnoreMatcher } from "../../src/safety/ignoreRules.js";
import { canSendToCloud } from "../../src/safety/privacyGuard.js";
import { redactText, scanSecrets } from "../../src/safety/secretScanner.js";
import { classifyProviderError, formatProviderError, redactProviderError, redactSessionRecord } from "../../src/safety/providerRedaction.js";
import { assessShellCommand } from "../../src/safety/shellGuard.js";
import { createEventLedger } from "../../src/core/events/eventLedger.js";

describe("safety", () => {
  it("detects secret-like assignments", () => {
    expect(scanSecrets("OPENAI_API_KEY=sk-test-value").length).toBe(1);
  });

  it("detects camelCase and generic credential assignments", () => {
    const content = [
      "apiKey = 'sk-test-key'",
      "privateKey: '-----BEGIN PRIVATE KEY-----'",
      "credential = 'gateway-secret'",
      "auth: 'session-token'",
      "passwd = 'database-password'"
    ].join("\n");

    expect(scanSecrets(content).filter((finding) => finding.kind === "api_key_assignment")).toHaveLength(5);
    expect(redactText(content)).not.toContain("gateway-secret");
    expect(redactText(content)).not.toContain("session-token");
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

  it("preserves audit-critical deliverable paths while redacting content", () => {
    const record = redactSessionRecord({
      state: {
        changedFiles: ["docs/benchmarks/runs/RunA20260619Alpha1234567890Report.md"],
        candidates: [{
          filesChanged: ["docs/benchmarks/runs/RunB20260619Beta1234567890Report.md"],
          unifiedDiff: "OPENROUTER_API_KEY=sk-123456789012345678901234"
        }]
      }
    });

    const serialized = JSON.stringify(record);
    expect(serialized).toContain("RunA20260619Alpha1234567890Report.md");
    expect(serialized).toContain("RunB20260619Beta1234567890Report.md");
    expect(serialized).not.toContain("sk-123456789012345678901234");
  });

  it("preserves run context workspaces needed for approval continuation", () => {
    const record = redactSessionRecord({
      state: {
        runContext: {
          executionCwd: "/tmp/tedge-fixture-demo-RunA20260619Alpha1234567890",
          fixtureWorkspace: "/tmp/tedge-fixture-demo-RunB20260619Beta1234567890"
        },
        eventArtifacts: [{ content: "OPENAI_API_KEY=sk-123456789012345678901234" }]
      }
    });

    const serialized = JSON.stringify(record);
    expect(serialized).toContain("tedge-fixture-demo-RunA20260619Alpha1234567890");
    expect(serialized).toContain("tedge-fixture-demo-RunB20260619Beta1234567890");
    expect(serialized).not.toContain("sk-123456789012345678901234");
  });

  it("blocks raw cloud context in privacy mode", () => {
    const decision = canSendToCloud("normal code", "privacy");
    expect(decision.allowed).toBe(false);
  });

  it("applies repo ignore rules before context indexing", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-ignore-"));
    try {
      await writeFile(path.join(cwd, ".gitignore"), "dist/\n");
      await writeFile(path.join(cwd, ".tomorrowedgeignore"), "private-notes.md\n");
      const matcher = createIgnoreMatcher(cwd, defaultConfig);

      expect(matcher.ignores("dist/bundle.js")).toBe(true);
      expect(matcher.ignores("private-notes.md")).toBe(true);
      expect(matcher.ignores("src/index.ts")).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("classifies risky file paths without opening file contents", () => {
    expect(classifyFileRisk(".env.local", 20)).toBe("sensitive");
    expect(classifyFileRisk("certs/app.pem", 20)).toBe("sensitive");
    expect(classifyFileRisk("screenshots/app.png", 20)).toBe("binary");
    expect(classifyFileRisk("logs/big.txt", 600_000)).toBe("large");
    expect(classifyFileRisk("src/index.ts", 20)).toBe("safe");
    expect(isBinaryLikePath("archive.zip")).toBe(true);
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
