import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { createBudgetRuntimeState, evaluateModelCallInvocation } from "../../src/core/budget/budgetGate.js";
import { buildDebateSession } from "../../src/core/debate/debateSessionBuilder.js";
import { validateEvidenceDependencies } from "../../src/core/evidence/evidenceDependency.js";
import { normalizeExternalAgentResponse } from "../../src/core/externalAgents/adapters/registry.js";
import { simulatePolicyOnTrace, runPolicyTournament } from "../../src/core/orchestrationPolicy/policyCounterfactual.js";
import { defaultOrchestrationPolicy } from "../../src/core/orchestrationPolicy/orchestrationPolicy.js";
import type { ObjectiveTraceV1 } from "../../src/core/traces/objectiveTrace.js";

describe("adaptive orchestration runtime", () => {
  it("records task graph, role node, evidence gap, and debate v2 events in a fixture run", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    const eventTypes = state.events.map((event) => event.type);

    expect(state.plan?.taskGraph).toBeTruthy();
    expect(state.roleGraphExecution).toBeTruthy();
    expect(state.debateSession?.moves.length).toBeGreaterThan(0);
    expect(eventTypes).toEqual(expect.arrayContaining(["task_graph", "role_node_result", "debate_move", "debate_resolution"]));
  });

  it("blocks runner execution when judge did not select a candidate", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      external_agents: {
        ...defaultConfig.external_agents,
        codex: {
          ...defaultConfig.external_agents.codex,
          enabled: true,
          roles: ["judge"],
          allowedRoles: ["judge"],
          capabilities: ["judgment"]
        }
      },
      agents: {
        ...defaultConfig.agents,
        judge: { provider: "external:codex", model: "auto" }
      }
    };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { fixtureMode: true });

    expect(state.finalSummary?.result).toBe("aborted");
    expect(state.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "evidence_gap", role: "runner", blocking: true }),
      expect.objectContaining({ type: "workflow_stop_reason", role: "runner" })
    ]));
    expect(state.events.some((event) => event.type === "patch_apply" && event.applied)).toBe(false);
  });

  it("does not fallback to native when a strict external coder returns malformed output", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      external_agents: {
        ...defaultConfig.external_agents,
        codex: {
          ...defaultConfig.external_agents.codex,
          enabled: true,
          command: process.execPath,
          args: ["-e", "console.log('not-json')"],
          autoStart: false,
          roles: ["coder_a"],
          allowedRoles: ["coder_a"],
          capabilities: ["coding"],
          strictJson: true,
          normalizationStrictness: "strict" as const
        }
      },
      agents: {
        ...defaultConfig.agents,
        coder_a: { provider: "external:codex", model: "auto" }
      }
    };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { fixtureMode: true });

    expect(state.finalSummary?.result).toBe("aborted");
    expect(state.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "external_agent_normalization", role: "coder_a", status: "failed" }),
      expect.objectContaining({ type: "role_node_result", role: "coder_a", status: "failed" })
    ]));
    expect(state.events.some((event) => event.type === "fallback_to_native" && event.role === "coder_a")).toBe(false);
  });

  it("validates evidence dependencies before judge and runner actions", () => {
    expect(validateEvidenceDependencies({ role: "judge", candidates: [] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ missing: "review decision", blocking: true }),
      expect.objectContaining({ missing: "patch candidate", blocking: true })
    ]));
    expect(validateEvidenceDependencies({ role: "runner", judge: { decision: "request_revision", reason: "not enough", confidence: 0.5 } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ missing: "select judgment", blocking: true })
    ]));
  });

  it("builds a debate session that blocks unresolved reviewer concerns", () => {
    const session = buildDebateSession({
      sessionId: "debate_test",
      maxRounds: 2,
      evidencePackets: [],
      debateRounds: [],
      candidates: [{
        candidateId: "candidate_a",
        agentId: "coder_a",
        approach: "minimal_patch",
        summary: "Patch auth boundary",
        filesChanged: ["auth.ts"],
        unifiedDiff: "--- a/auth.ts\n+++ b/auth.ts\n@@ -1 +1 @@\n-old\n+new\n",
        testPlan: ["npm test"],
        knownTradeoffs: [],
        estimatedRisk: "medium"
      }],
      review: {
        mode: "standard",
        overallRecommendation: "needs revision",
        reviews: [{
          candidateId: "candidate_a",
          correctnessScore: 50,
          riskScore: 80,
          invasiveness: "medium",
          testCoverage: "weak",
          securityConcerns: ["token validation not covered"],
          regressionConcerns: [],
          redTeamFindings: [],
          recommendation: "revise",
          notes: []
        }]
      }
    });

    expect(session.resolution).toBe("request_revision");
    expect(session.unresolvedBlockingIssues).toContain("token validation not covered");
  });

  it("normalizes external Codex and Claude Code outputs through adapters", () => {
    const codex = normalizeExternalAgentResponse({
      profile: { id: "codex", name: "Codex", transport: "mcp", adapter: "codex", capabilities: [], allowedRoles: ["planner"], trustLevel: "high" },
      role: "planner",
      outputContract: "plan",
      rawPayload: "```json\n{\"summary\":\"planned\",\"plan\":{\"steps\":[]}}\n```"
    });
    const claude = normalizeExternalAgentResponse({
      profile: { id: "claude_code", name: "Claude Code", transport: "mcp", adapter: "claude_code", capabilities: [], allowedRoles: ["reviewer"], trustLevel: "high" },
      role: "reviewer",
      outputContract: "review",
      rawPayload: { summary: "reviewed" }
    });

    expect(codex.status).toBe("success");
    expect(codex.adapter).toBe("codex");
    expect(claude.summary).toBe("reviewed");
  });

  it("uses unified budget gate for model invocation kinds", () => {
    const decision = evaluateModelCallInvocation({
      config: { ...defaultConfig, strong_agents: { ...defaultConfig.strong_agents, max_calls_per_task: 0 } },
      runtime: createBudgetRuntimeState(),
      invocation: "pre_judge_debate",
      role: "judge",
      assignment: { role: "judge", provider: "openrouter", model: "openai/gpt-5.2", reason: "judge" },
      estimatedCostUsd: 0.02
    });

    expect(decision.action).toBe("block");
    expect(decision.phase).toBe("judge");
  });

  it("scores policy counterfactuals and tournaments differently", () => {
    const base = defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z");
    const strict = {
      ...base,
      policyId: "strict",
      verificationPolicy: { ...base.verificationPolicy, verificationStrictness: "strict" as const },
      stopPolicy: { ...base.stopPolicy, stopMode: "evidence_strict" as const, allowPartialCompletion: false }
    };
    const light = {
      ...base,
      policyId: "light",
      contractPolicy: { ...base.contractPolicy, contractDepth: "light" as const, requireEvidence: false },
      verificationPolicy: { ...base.verificationPolicy, verificationStrictness: "light" as const, requireEvidencePacket: false },
      stopPolicy: { ...base.stopPolicy, stopMode: "early" as const, allowPartialCompletion: true }
    };
    const trace = makeTrace();

    const strictReplay = simulatePolicyOnTrace(strict, trace, base);
    const lightReplay = simulatePolicyOnTrace(light, trace, base);
    const tournament = runPolicyTournament([strict, light], [trace]);

    expect(strictReplay.simulatedStatus).toBe("failure");
    expect(lightReplay.simulatedStatus).toBe("partial");
    expect(tournament.evaluatedPolicies).toBe(2);
    expect(tournament.winnerPolicyId).toBeTruthy();
  });
});

function makeTrace(): ObjectiveTraceV1 {
  const policy = defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z");
  return {
    schemaVersion: "objective-trace/v1",
    traceId: "trace_partial",
    runId: "session_partial",
    createdAt: "2026-06-10T00:00:00.000Z",
    goal: "fix failing test",
    scenarioProfile: {
      scenarioType: "debugging",
      likelyWorkflowKind: "patch",
      ambiguityLevel: "low",
      expectedDeliverable: "patch",
      riskSignals: [],
      requiredCapabilities: [],
      recommendedRoles: ["planner", "coder_a", "reviewer", "judge"],
      evidenceNeeds: []
    },
    policySummary: undefined,
    contract: {
      schemaVersion: "objective-contract/v1",
      contractId: "contract_test",
      goal: "fix failing test",
      localObjective: "Fix the failing test",
      taskType: "bugfix",
      workflowKind: "patch",
      userScenario: { scenarioType: "debugging", ambiguityLevel: "low", expectedDeliverable: "patch" },
      riskLevel: "medium",
      reasoningSensitivity: "medium",
      successCriteria: ["tests pass"],
      failureCriteria: ["tests fail"],
      requiredEvidence: ["patch diff", "verification result"],
      allowedTools: ["patch_apply", "shell"],
      allowedRoles: ["planner", "coder_a", "reviewer", "judge", "runner", "summarizer"],
      allowedPhases: ["planning", "coding", "review", "judge", "patch", "shell", "summary"],
      forbiddenActions: [],
      verificationRubric: {
        requiredCommands: ["npm test"],
        requiredArtifacts: ["diff"],
        evidenceChecks: [],
        reviewerChecks: [],
        judgeChecks: []
      },
      stopCondition: { success: ["tests pass"], partial: [], failure: ["tests fail"], unsafe: [] },
      budget: { maxSteps: 6, maxRepairRounds: policy.repairPolicy.maxRepairRounds, maxShellRuns: 1 },
      confidence: 0.8,
      source: "native"
    },
    contractVerification: { status: "passed", score: 90, missing: [], violations: [], repairs: [] },
    planSummary: { workflowKind: "patch", steps: ["plan", "patch"], allowedPhases: ["planning", "coding"], verificationCommands: ["npm test"] },
    roleGraphSummary: { rolesUsed: ["planner", "coder_a"], routingDecisions: [], fallbackDecisions: [] },
    executionSummary: { actions: [], toolCalls: [], observations: [], shellRuns: 0, filesTouched: [] },
    evidenceSummary: { evidencePacketRefs: [], requiredEvidenceSatisfied: ["patch diff"], missingEvidence: ["verification result"], evidenceScore: 50 },
    verificationSummary: { status: "partial", passedCriteria: [], failedCriteria: ["tests fail"] },
    repairSummary: { repairAttempts: 0, recovered: false },
    costSummary: { toolCalls: 1, shellRuns: 0, estimatedCostUsd: 0.01 },
    feedback: { implicitSignals: [] },
    traceCompleteness: { score: 50, missing: ["shell run"] },
    outcome: { finalStatus: "partial", lessons: ["Need verification evidence"] }
  };
}
