import { afterEach, describe, expect, it } from "vitest";
import { estimateCostUsd, preflightBudget, summarizeModelUsage } from "../../src/core/model/costAccounting.js";

describe("cost accounting", () => {
  afterEach(() => {
    delete process.env.MOCK_INPUT_PRICE_PER_MTOK;
    delete process.env.MOCK_OUTPUT_PRICE_PER_MTOK;
    delete process.env.BUDGETMOCK_INPUT_PRICE_PER_MTOK;
    delete process.env.BUDGETMOCK_OUTPUT_PRICE_PER_MTOK;
  });

  it("summarizes token usage even when prices are unknown", () => {
    const summary = summarizeModelUsage([
      {
        id: "n1",
        role: "planner",
        provider: "mock",
        model: "mock-balanced",
        kind: "plan_advice",
        content: "ok",
        usage: { inputTokens: 100, outputTokens: 50 }
      }
    ]);

    expect(summary.totalTokens).toBe(150);
    expect(summary.estimatedCostUsd).toBeUndefined();
  });

  it("estimates USD from per-million-token env prices", () => {
    process.env.MOCK_INPUT_PRICE_PER_MTOK = "1";
    process.env.MOCK_OUTPUT_PRICE_PER_MTOK = "2";

    expect(estimateCostUsd("mock", { inputTokens: 1_000_000, outputTokens: 500_000 })).toBe(2);
  });

  it("blocks when preflight estimate exceeds the configured budget", () => {
    process.env.BUDGETMOCK_INPUT_PRICE_PER_MTOK = "1";
    process.env.BUDGETMOCK_OUTPUT_PRICE_PER_MTOK = "1";

    const status = preflightBudget([{ provider: "budgetmock", prompt: "x".repeat(4000), maxOutputTokens: 1_000_000 }], 0.5);

    expect(status.status).toBe("blocked");
    expect(status.estimatedCostUsd).toBeGreaterThan(0.5);
  });

  it("reports unknown price when a routed provider has no price config", () => {
    const status = preflightBudget([{ provider: "mock", prompt: "hello", maxOutputTokens: 100 }], 1);

    expect(status.status).toBe("price_unknown");
    expect(status.estimatedCostUsd).toBeUndefined();
  });

  it("uses default cloud provider prices when env prices are absent", () => {
    const status = preflightBudget([{ provider: "openrouter", prompt: "hello", maxOutputTokens: 100 }], 1);

    expect(status.status).toBe("within_budget");
    expect(status.estimatedCostUsd).toBeGreaterThan(0);
  });
});
