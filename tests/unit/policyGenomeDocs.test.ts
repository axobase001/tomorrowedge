import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Orchestration Policy Genome docs", () => {
  it("documents the evolutionary-policy innovation and immutable safety boundary", async () => {
    const readme = await readFile(path.join(process.cwd(), "README.md"), "utf8");
    const selfIterating = await readFile(path.join(process.cwd(), "docs", "SELF_ITERATING_ORCHESTRATION.md"), "utf8");
    const policyEvolution = await readFile(path.join(process.cwd(), "docs", "POLICY_EVOLUTION.md"), "utf8");
    const combined = `${readme}\n${selfIterating}\n${policyEvolution}`;
    const normalized = combined.replace(/\s+/g, " ").toLowerCase();

    expect(combined).toContain("Core innovation: Orchestration Policy Genome");
    expect(combined).toContain("inspired by evolutionary algorithms");
    expect(normalized).toContain("the unit of evolution is not answer, prompt, or agent; it is orchestration policy.");
    expect(normalized).toContain("objective-action-feedback trace is the fitness signal");
    expect(combined).toContain("The safety boundary cannot be mutated");
  });
});
