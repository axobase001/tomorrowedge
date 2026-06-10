import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { generateNativeObjectiveContract } from "../../src/core/contracts/contractGenerator.js";
import { classifyWorkflowIntentLocally, type WorkflowIntentDecision } from "../../src/core/goal/workflowIntent.js";
import { defaultOrchestrationPolicy } from "../../src/core/orchestrationPolicy/orchestrationPolicy.js";
import { profileScenario } from "../../src/core/scenarios/scenarioProfiler.js";
import { builtinSkillPacks } from "../../src/core/skills/builtinSkillPacks.js";
import { transitionSkillLifecycle } from "../../src/core/skills/skillLifecycle.js";
import { proposeCandidateSkillsFromTraces } from "../../src/core/skills/skillProposal.js";
import { SkillRegistry, duplicateSkillKeys, loadSkillRegistry } from "../../src/core/skills/skillRegistry.js";
import { scoreToolSkillPerformance } from "../../src/core/skills/skillScoring.js";
import type { SkillManifestV1 } from "../../src/core/skills/skillTypes.js";
import { validateSkillManifest } from "../../src/core/skills/skillTypes.js";
import { validateSkillCandidate } from "../../src/core/skills/skillValidation.js";
import { routeToolsAndSkills } from "../../src/core/skills/toolSkillRouter.js";
import type { ObjectiveTraceV1 } from "../../src/core/traces/objectiveTrace.js";

describe("governed skills and tool packs", () => {
  it("validates built-in skill packs and exposes recipe-derived skills", () => {
    const registry = new SkillRegistry(builtinSkillPacks());
    const skills = registry.listSkills();

    expect(skills.some((skill) => skill.skillId === "recipe.bugfix-sprint")).toBe(true);
    expect(skills.some((skill) => skill.skillId === "workspace.apply_patch")).toBe(true);
    expect(skills.some((skill) => skill.skillId === "code.run_tests")).toBe(true);
    expect(skills.some((skill) => skill.skillId === "github.pr_get")).toBe(true);
    expect(skills.some((skill) => skill.skillId === "web.search")).toBe(true);
    expect(skills.some((skill) => skill.skillId === "docs.read_pdf")).toBe(true);
    expect(skills.some((skill) => skill.skillId === "data.safe_sql_query")).toBe(true);
    expect(skills.some((skill) => skill.skillId === "api.http_smoke")).toBe(true);
    expect(duplicateSkillKeys(registry.listPacks())).toEqual([]);
    expect(validateSkillManifest(skills[0])).toMatchObject({ ok: true });
  });

  it("loads project-local skill packs and filters by scenario and access mode", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-skills-"));
    try {
      await mkdir(path.join(cwd, ".tomorrowedge", "skills"), { recursive: true });
      await writeFile(path.join(cwd, ".tomorrowedge", "skills", "custom.json"), JSON.stringify({
        schemaVersion: "skill-pack/v1",
        packId: "custom_docs",
        version: "1.0.0",
        name: "Custom docs",
        description: "Custom docs pack",
        kind: "skill_pack",
        domainTags: ["docs"],
        userStories: ["summarize docs"],
        enabledByDefault: true,
        skills: [makeSkill({ skillId: "custom.docs_summary", scenarios: ["document"], allowedAccessModes: ["restricted"] })]
      }, null, 2), "utf8");

      const loaded = await loadSkillRegistry(cwd);
      const docs = loaded.registry.listSkills({ scenarioType: "document", accessMode: "restricted" });

      expect(loaded.errors).toEqual([]);
      expect(docs.some((skill) => skill.skillId === "custom.docs_summary")).toBe(true);
      expect(loaded.registry.listSkills({ scenarioType: "document", accessMode: "full" }).some((skill) => skill.skillId === "custom.docs_summary")).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("blocks unsafe candidate validation before promotion", () => {
    const unsafe = makeSkill({
      skillId: "candidate.unsafe_shell",
      provenance: "agent_candidate",
      lifecycle: "candidate",
      allowedAccessModes: ["restricted", "partial"],
      requiredTools: ["shell"],
      intents: ["read", "shell"],
      shellAllowed: true,
      verificationCommands: []
    });

    const report = validateSkillCandidate({ candidate: unsafe, accessMode: "restricted", sandboxProfile: { mode: "fixture" } });

    expect(report.status).toBe("blocked");
    expect(report.blockingConcerns.join("\n")).toContain("restricted mode");
    expect(report.blockingConcerns.join("\n")).toContain("shell permission requires");
  });

  it("enforces lifecycle transitions and rollback evidence", () => {
    const candidate = makeSkill({ lifecycle: "candidate", provenance: "agent_candidate" });
    const validated = transitionSkillLifecycle(candidate, {
      transition: "validate",
      actor: "tester",
      reason: "fixture passed",
      validationReportId: "report_1",
      now: "2026-06-10T00:00:00.000Z"
    });
    const stable = transitionSkillLifecycle(validated, {
      transition: "promote",
      actor: "operator",
      reason: "approved",
      validationReportId: "report_1",
      now: "2026-06-10T00:00:01.000Z"
    });

    expect(stable.lifecycle).toBe("stable");
    expect(stable.lifecycleHistory.map((item) => item.to)).toEqual(["candidate", "validated", "stable"]);
    expect(() => transitionSkillLifecycle(stable, { transition: "rollback", actor: "operator", reason: "bad", now: "2026-06-10T00:00:02.000Z" })).toThrow(/previousVersion/);
  });

  it("routes only contract-compatible stable skills", () => {
    const { contract, scenarioProfile } = contractFor("fix failing test");
    const registry = new SkillRegistry(builtinSkillPacks());
    const policy = {
      ...defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z"),
      toolRoutingPolicy: { preference: "trace_score" as const, allowCandidateSkills: false, requireValidation: true }
    };
    const routes = routeToolsAndSkills({
      registry,
      contract: { ...contract, riskLevel: "medium" },
      scenarioProfile,
      accessMode: "partial",
      policy,
      traceScores: { "code.run_tests": 99 }
    });

    expect(routes.some((route) => route.selected && route.skillId === "code.run_tests")).toBe(true);
    expect(routes.every((route) => route.lifecycle !== "candidate")).toBe(true);
  });

  it("keeps network and database tool packs behind contract and access-mode gates", () => {
    const { contract, scenarioProfile } = contractFor("inspect current API and database docs");
    const registry = new SkillRegistry(builtinSkillPacks());
    const policy = defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z");
    const allowedContract = {
      ...contract,
      riskLevel: "high" as const,
      allowedTools: [...contract.allowedTools, "web_search", "web_open", "database_query", "http"]
    };

    const partialRoutes = routeToolsAndSkills({
      registry,
      contract: allowedContract,
      scenarioProfile: { ...scenarioProfile, scenarioType: "analysis" },
      accessMode: "partial",
      policy,
      limit: 100
    });
    const restrictedRoutes = routeToolsAndSkills({
      registry,
      contract: allowedContract,
      scenarioProfile: { ...scenarioProfile, scenarioType: "analysis" },
      accessMode: "restricted",
      policy,
      limit: 100
    });

    expect(partialRoutes.some((route) => route.selected && route.skillId === "web.search")).toBe(true);
    expect(partialRoutes.some((route) => route.selected && route.skillId === "data.safe_sql_query")).toBe(true);
    expect(restrictedRoutes.some((route) => route.selected && route.skillId === "web.search")).toBe(false);
    expect(restrictedRoutes.some((route) => route.selected && route.skillId === "data.safe_sql_query")).toBe(false);
  });

  it("proposes inert candidate skills from repeated successful traces and scores tool usage", () => {
    const traces = [
      makeTrace("trace_a", "success"),
      makeTrace("trace_b", "success"),
      makeTrace("trace_c", "failure")
    ];

    const proposals = proposeCandidateSkillsFromTraces(traces, { minSupport: 2, minSuccessRate: 0.6 });
    const scores = scoreToolSkillPerformance(traces);

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe("candidate");
    expect(proposals[0]?.proposedSkill.lifecycle).toBe("candidate");
    expect(proposals[0]?.proposedSkill.provenance).toBe("agent_candidate");
    expect(scores.find((score) => score.id === "code.run_tests")?.invocations).toBe(3);
    expect(scores.find((score) => score.id === "code.run_tests")?.successes).toBe(2);
  });
});

function contractFor(goal: string) {
  const workflowIntent = withProvider(classifyWorkflowIntentLocally(goal));
  const scenarioProfile = profileScenario({ goal, workflowIntent, accessMode: "partial" });
  const contract = generateNativeObjectiveContract({
    goal,
    workflowIntent,
    scenarioProfile,
    retrievedTraces: [],
    config: defaultConfig,
    accessMode: "partial"
  });
  return { contract, scenarioProfile };
}

function makeTrace(traceId: string, status: ObjectiveTraceV1["outcome"]["finalStatus"]): ObjectiveTraceV1 {
  const { contract, scenarioProfile } = contractFor("fix failing test");
  return {
    schemaVersion: "objective-trace/v1",
    traceId,
    runId: `session_${traceId}`,
    createdAt: "2026-06-10T00:00:00.000Z",
    goal: "fix failing test",
    scenarioProfile,
    contract,
    contractVerification: { status: "passed", score: 90, missing: [], violations: [], repairs: [] },
    planSummary: { workflowKind: contract.workflowKind, steps: ["plan", "test"], allowedPhases: contract.allowedPhases, verificationCommands: ["npm test"] },
    roleGraphSummary: { rolesUsed: ["planner", "coder_a", "reviewer", "judge"], routingDecisions: [], fallbackDecisions: [] },
    executionSummary: { actions: [], toolCalls: [], observations: [], shellRuns: 1, filesTouched: status === "success" ? ["index.js"] : [] },
    toolUsage: [{
      toolId: "shell",
      skillId: "code.run_tests",
      version: "1.0.0",
      phase: "shell",
      role: "runner",
      permissionIntents: ["shell"],
      outcome: status === "success" ? "success" : "failure",
      artifactRefs: ["artifacts/stdout/test.txt"],
      command: "npm test",
      exitCode: status === "success" ? 0 : 1,
      durationMs: 100
    }],
    evidenceSummary: { evidencePacketRefs: [], requiredEvidenceSatisfied: ["event ledger"], missingEvidence: [], evidenceScore: status === "success" ? 95 : 60 },
    verificationSummary: { status: status === "success" ? "success" : "failure", passedCriteria: [], failedCriteria: [] },
    repairSummary: { repairAttempts: 0, recovered: false },
    costSummary: { toolCalls: 1, shellRuns: 1 },
    feedback: { implicitSignals: [] },
    traceCompleteness: { score: status === "success" ? 95 : 70, missing: [] },
    outcome: { finalStatus: status, lessons: ["Run tests after patch."] }
  };
}

function makeSkill(overrides: Partial<SkillManifestV1> & { shellAllowed?: boolean; intents?: SkillManifestV1["permissions"]["intents"] } = {}): SkillManifestV1 {
  const intents = overrides.intents ?? ["read"];
  return {
    schemaVersion: "skill-manifest/v1",
    skillId: overrides.skillId ?? "candidate.test_skill",
    version: overrides.version ?? "0.1.0",
    name: overrides.name ?? "Test skill",
    description: overrides.description ?? "Test skill manifest",
    tags: overrides.tags ?? [],
    scenarios: overrides.scenarios ?? ["debugging"],
    userStories: overrides.userStories ?? ["fix failing test"],
    inputs: overrides.inputs ?? ["objective contract"],
    outputs: overrides.outputs ?? ["evidence"],
    requiredArtifacts: overrides.requiredArtifacts ?? ["trace"],
    verificationCommands: overrides.verificationCommands ?? ["npm test"],
    requiredTools: overrides.requiredTools ?? ["repo_index", "file_read"],
    permissions: overrides.permissions ?? {
      intents,
      allowedTools: overrides.requiredTools ?? ["repo_index", "file_read"],
      filesystem: { read: true, write: intents.includes("write"), pathScope: "workspace" },
      shell: { allowed: overrides.shellAllowed ?? intents.includes("shell"), commands: overrides.verificationCommands ?? [] },
      network: { allowed: false, hosts: [] },
      github: { read: false, write: false }
    },
    allowedAccessModes: overrides.allowedAccessModes ?? ["restricted", "partial", "full"],
    riskLevel: overrides.riskLevel ?? "low",
    provenance: overrides.provenance ?? "agent_candidate",
    lifecycle: overrides.lifecycle ?? "candidate",
    owner: overrides.owner,
    sourceRecipeId: overrides.sourceRecipeId,
    validationReportId: overrides.validationReportId,
    previousVersion: overrides.previousVersion,
    rollbackToVersion: overrides.rollbackToVersion,
    fixtures: overrides.fixtures ?? [{ id: "fixture", description: "fixture", commands: ["npm test"] }],
    sandbox: overrides.sandbox ?? { required: true, profile: "fixture" },
    lifecycleHistory: overrides.lifecycleHistory ?? [{ to: overrides.lifecycle ?? "candidate", reason: "test", actor: "test", evidenceRefs: [], at: "2026-06-10T00:00:00.000Z" }]
  };
}

function withProvider(decision: Omit<WorkflowIntentDecision, "provider" | "model" | "fallbackUsed">): WorkflowIntentDecision {
  return { ...decision, provider: "test", model: "local" };
}
