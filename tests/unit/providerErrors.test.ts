import { describe, expect, it } from "vitest";
import { classifyProviderError } from "../../src/providers/providerErrors.js";

describe("provider error diagnostics", () => {
  it.each([
    ["rate_limited", "openrouter request failed: 429 {\"error\":{\"message\":\"Too many requests\"}}", true],
    ["quota_exhausted", "openrouter request failed: 429 {\"error\":{\"message\":\"Rate limit exceeded: free-models-per-day quota exhausted\"}}", false],
    ["upstream_unavailable", "openrouter request failed: 503 {\"error\":{\"message\":\"upstream service unavailable\"}}", true],
    ["invalid_model", "openrouter request failed: 404 {\"error\":{\"message\":\"model not found\"}}", false],
    ["invalid_key", "openrouter request failed: 401 {\"error\":{\"message\":\"invalid API key\"}}", false]
  ] as const)("classifies %s", (category, message, retryable) => {
    const diagnostic = classifyProviderError(new Error(message));

    expect(diagnostic.category).toBe(category);
    expect(diagnostic.retryable).toBe(retryable);
    expect(diagnostic.skipLiveCalls).toBe(true);
  });

  it("redacts provider identifiers in diagnostic messages", () => {
    const diagnostic = classifyProviderError(
      new Error('openrouter request failed: 429 {"error":{"message":"Too many requests"},"request_id":"req_live_456","org_id":"org_live_789","accountId":"acct_live_123"}')
    );

    expect(diagnostic.message).not.toContain("req_live_456");
    expect(diagnostic.message).not.toContain("org_live_789");
    expect(diagnostic.message).not.toContain("acct_live_123");
    expect(diagnostic.message).toContain("[redacted]");
  });
});
