import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { createBudgetRuntimeState, evaluateModelCallInvocation } from "../../src/core/budget/budgetGate.js";
import { buildDebateSession } from "../../src/core/debate/debateSessionBuilder.js";
import type { DebateSession } from "../../src/core/debate/debateProtocol.js";
import { validateEvidenceDependencies } from "../../src/core/evidence/evidenceDependency.js";
import { detectExternalAgentFailure, extractExternalAgentEvidencePackets, normalizeExternalAgentResponse } from "../../src/core/externalAgents/adapters/registry.js";
import { JudgeAgent } from "../../src/core/agents/judge.js";
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

  it("keeps ordinary security concerns candidate-scoped by default", () => {
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

    expect(session.globalResolution.resolution).toBe("selectable");
    expect(session.resolution).toBe("selectable");
    expect(session.unresolvedBlockingIssues).not.toContain("token validation not covered");
    expect(session.candidateResolutions.candidate_a?.resolution).toBe("request_revision");
    expect(session.unresolvedIssues[0]).toMatchObject({ title: "token validation not covered", candidateId: "candidate_a", blocking: true });
  });

  it("does not let candidate_b local security concerns block candidate_a", () => {
    const session = buildDebateSession({
      sessionId: "debate_local_security",
      maxRounds: 2,
      evidencePackets: [],
      debateRounds: [],
      candidates: [
        patchCandidate("candidate_a", "coder_a", "--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-a\n+b\n"),
        patchCandidate("candidate_b", "coder_b", "--- a/auth.ts\n+++ b/auth.ts\n@@ -1 +1 @@\n-old\n+new\n")
      ],
      review: {
        mode: "standard",
        overallRecommendation: "accept candidate_a, revise candidate_b",
        reviews: [
          reviewItem("candidate_a", "accept", 94, 10),
          { ...reviewItem("candidate_b", "revise", 55, 80), securityConcerns: ["candidate_b does not validate nonce replay"] }
        ]
      }
    });

    expect(session.resolution).toBe("selectable");
    expect(session.globalResolution.resolution).toBe("selectable");
    expect(session.candidateResolutions.candidate_a?.resolution).toBe("selectable");
    expect(session.candidateResolutions.candidate_b?.resolution).toBe("request_revision");
  });

  it("keeps credential leakage security concerns global", () => {
    const session = buildDebateSession({
      sessionId: "debate_global_secret",
      maxRounds: 2,
      evidencePackets: [],
      debateRounds: [],
      candidates: [patchCandidate("candidate_a", "coder_a", "--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-a\n+b\n")],
      review: {
        mode: "standard",
        overallRecommendation: "revise",
        reviews: [{
          ...reviewItem("candidate_a", "revise", 60, 90),
          securityConcerns: ["credential secret leakage risk in shared auth boundary"]
        }]
      }
    });

    expect(session.globalResolution.resolution).toBe("request_revision");
    expect(session.resolution).toBe("request_revision");
    expect(session.unresolvedIssues[0]).toMatchObject({ candidateId: undefined, title: "credential secret leakage risk in shared auth boundary" });
  });

  it("lets a good selected candidate ignore candidate-scoped issues on a rejected alternative", async () => {
    const judge = new JudgeAgent();
    const decision = await judge.run({
      candidates: [],
      allowPartialCompletion: false,
      riskLevel: "medium",
      evidencePackets: [],
      debateRounds: [],
      review: {
        mode: "standard",
        overallRecommendation: "accept candidate_a",
        reviews: [
          reviewItem("candidate_a", "accept", 92, 15),
          reviewItem("candidate_b", "revise", 20, 80)
        ]
      },
      debateSession: debateSessionWithIssues([{ id: "issue_b_no_diff", candidateId: "candidate_b", title: "candidate_b has no diff" }])
    });

    expect(decision.decision).toBe("select");
    expect(decision.selectedCandidateId).toBe("candidate_a");
    expect(decision.unresolvedBlockingIssues).toEqual([]);
    expect(decision.selectedCandidateBlockingIssues).toEqual([]);
    expect(decision.nonSelectedCandidateIssues?.[0]).toMatchObject({ candidateId: "candidate_b" });
  });

  it("requests revision when the selected candidate has an unresolved blocking issue", async () => {
    const judge = new JudgeAgent();
    const decision = await judge.run({
      candidates: [],
      allowPartialCompletion: false,
      riskLevel: "medium",
      evidencePackets: [],
      debateRounds: [],
      review: {
        mode: "standard",
        overallRecommendation: "accept candidate_a",
        reviews: [reviewItem("candidate_a", "accept", 92, 15)]
      },
      debateSession: debateSessionWithIssues([{ id: "issue_a", candidateId: "candidate_a", title: "candidate_a lacks verifier evidence" }])
    });

    expect(decision.decision).toBe("request_revision");
    expect(decision.reason).toContain("candidate_a lacks verifier evidence");
    expect(decision.selectedCandidateBlockingIssues?.[0]).toMatchObject({ candidateId: "candidate_a" });
  });

  it("blocks all candidates on unresolved global security issues", async () => {
    const judge = new JudgeAgent();
    const decision = await judge.run({
      candidates: [],
      allowPartialCompletion: true,
      riskLevel: "medium",
      evidencePackets: [],
      debateRounds: [],
      review: {
        mode: "standard",
        overallRecommendation: "accept candidate_a",
        reviews: [reviewItem("candidate_a", "accept", 92, 15)]
      },
      debateSession: debateSessionWithIssues([{ id: "global_secret", title: "global secret leakage risk" }])
    });

    expect(decision.decision).toBe("request_revision");
    expect(decision.reason).toContain("global secret leakage risk");
    expect(decision.globalBlockingIssues?.[0]).toMatchObject({ id: "global_secret" });
  });

  it("keeps debate session resolution selectable when only a non-selected candidate has unresolved issues", async () => {
    const session = buildDebateSession({
      sessionId: "debate_non_selected_issue",
      maxRounds: 2,
      evidencePackets: [],
      debateRounds: [],
      candidates: [
        patchCandidate("candidate_a", "coder_a", "--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-a\n+b\n"),
        patchCandidate("candidate_b", "coder_b", "")
      ],
      review: {
        mode: "standard",
        overallRecommendation: "accept candidate_a; revise candidate_b",
        reviews: [
          reviewItem("candidate_a", "accept", 92, 15),
          { ...reviewItem("candidate_b", "revise", 20, 80), regressionConcerns: ["candidate_b has no diff"] }
        ]
      }
    });

    expect(session.resolution).toBe("selectable");
    expect(session.globalResolution.resolution).toBe("selectable");
    expect(session.candidateResolutions.candidate_a?.resolution).toBe("selectable");
    expect(session.candidateResolutions.candidate_b?.resolution).toBe("request_revision");
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

  it("extracts adapter JSON when responseMode=json_block and text precedes the block", () => {
    const normalized = normalizeExternalAgentResponse({
      profile: { id: "codex", name: "Codex", transport: "mcp", adapter: "codex", responseMode: "json_block", capabilities: [], allowedRoles: ["planner"], trustLevel: "high" },
      role: "planner",
      outputContract: "plan",
      rawPayload: "I inspected the task.\n\n```json\n{\"summary\":\"planned\",\"plan\":{\"steps\":[{\"id\":\"inspect\",\"title\":\"Inspect\",\"detail\":\"Read files\"}],\"riskLevel\":\"low\",\"taskType\":\"analysis\"}}\n```"
    });

    expect(normalized.status).toBe("success");
    expect((normalized.payload as { plan?: { steps?: unknown[] } }).plan?.steps).toHaveLength(1);
  });

  it("rejects natural-language-only strict Codex output", () => {
    const normalized = normalizeExternalAgentResponse({
      profile: { id: "codex", name: "Codex", transport: "mcp", adapter: "codex", strictJson: true, normalizationStrictness: "strict", capabilities: [], allowedRoles: ["coder_a"], trustLevel: "high" },
      role: "coder_a",
      outputContract: "patch",
      rawPayload: "I cannot safely produce a patch without more context."
    });
    const failure = detectExternalAgentFailure({
      profile: { id: "codex", name: "Codex", transport: "mcp", adapter: "codex", strictJson: true, normalizationStrictness: "strict", capabilities: [], allowedRoles: ["coder_a"], trustLevel: "high" },
      role: "coder_a",
      outputContract: "patch",
      rawPayload: "I cannot safely produce a patch without more context.",
      normalized
    });

    expect(normalized.status).toBe("failed");
    expect(failure).toMatchObject({ failed: true, retryable: true, category: "malformed_output" });
  });

  it("normalizes Codex raw patch output into a PatchCandidate", () => {
    const normalized = normalizeExternalAgentResponse({
      profile: { id: "codex", name: "Codex", transport: "mcp", adapter: "codex", capabilities: [], allowedRoles: ["coder_a"], trustLevel: "high" },
      role: "coder_a",
      outputContract: "patch",
      rawPayload: "--- a/index.js\n+++ b/index.js\n@@ -1,3 +1,3 @@\n export function add(a, b) {\n-  return a - b;\n+  return a + b;\n }\n"
    });
    const payload = normalized.payload as { candidate?: { filesChanged?: string[]; unifiedDiff?: string } };

    expect(normalized.status).toBe("success");
    expect(payload.candidate?.filesChanged).toEqual(["index.js"]);
    expect(payload.candidate?.unifiedDiff).toContain("return a + b");
  });

  it("turns Codex stdout with raw diff and JSON notes into a patch candidate with stable diff evidence", () => {
    const rawDiff = "diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n@@ -1,3 +1,3 @@\n export function add(a, b) {\n-  return a - b;\n+  return a + b;\n }\n";
    const normalized = normalizeExternalAgentResponse({
      profile: { id: "codex_cli", name: "Codex CLI", transport: "mcp", adapter: "codex", capabilities: [], allowedRoles: ["coder_a"], trustLevel: "high" },
      role: "coder_a",
      outputContract: "patch",
      rawPayload: `${rawDiff}\n{\"summary\":\"metadata after diff\"}`
    });
    const packets = extractExternalAgentEvidencePackets({
      profile: { id: "codex_cli", name: "Codex CLI", transport: "mcp", adapter: "codex", capabilities: [], allowedRoles: ["coder_a"], trustLevel: "high" },
      role: "coder_a",
      outputContract: "patch",
      rawPayload: `${rawDiff}\n{\"summary\":\"metadata after diff\"}`,
      normalized
    });
    const payload = normalized.payload as { candidate?: { unifiedDiff?: string }; diffRef?: string };

    expect(normalized.status).toBe("success");
    expect(payload.candidate?.unifiedDiff).toContain("return a + b");
    expect(payload.diffRef).toMatch(/^external:\/\/codex_cli\/diffs\/external_codex_diff_[a-f0-9]+\.patch$/);
    expect(packets[0]?.supportingArtifacts).toContain(payload.diffRef);
  });

  it("treats empty Codex candidate explanations as retryable missing-contract failures", () => {
    const profile = { id: "codex", name: "Codex", transport: "mcp" as const, adapter: "codex" as const, capabilities: [], allowedRoles: ["coder_a" as const], trustLevel: "high" as const };
    const rawPayload = { summary: "No safe patch yet.", explanation: "Need the target file before editing." };
    const normalized = normalizeExternalAgentResponse({ profile, role: "coder_a", outputContract: "patch", rawPayload });
    const failure = detectExternalAgentFailure({ profile, role: "coder_a", outputContract: "patch", rawPayload, normalized });

    expect(normalized.status).toBe("warning");
    expect(failure).toMatchObject({ failed: true, retryable: true, category: "missing_contract" });
  });

  it("normalizes Codex reviewer output into candidate-scoped debate issues", () => {
    const normalized = normalizeExternalAgentResponse({
      profile: { id: "codex", name: "Codex", transport: "mcp", adapter: "codex", capabilities: [], allowedRoles: ["reviewer"], trustLevel: "high" },
      role: "reviewer",
      outputContract: "review",
      rawPayload: {
        summary: "reviewed",
        review: {
          mode: "standard",
          reviews: [{
            candidateId: "candidate_b",
            correctnessScore: 30,
            riskScore: 85,
            invasiveness: "low",
            testCoverage: "weak",
            securityConcerns: [],
            regressionConcerns: ["candidate_b has no diff"],
            recommendation: "revise",
            notes: []
          }],
          overallRecommendation: "revise candidate_b"
        }
      }
    });
    const payload = normalized.payload as { issues?: Array<{ candidateId?: string; title?: string; blocking?: boolean }> };

    expect(normalized.status).toBe("success");
    expect(payload.issues?.[0]).toMatchObject({ candidateId: "candidate_b", title: "candidate_b has no diff", blocking: true });
  });

  it("normalizes Claude planner output into a Plan with TaskGraph", () => {
    const taskGraph = {
      schemaVersion: "task-graph/v1",
      graphId: "external_readonly",
      goal: "inspect repo",
      rootObjective: "inspect repo",
      workflowKind: "read_only",
      riskLevel: "low",
      nodes: [
        {
          id: "inspect",
          kind: "inspect",
          title: "Inspect files",
          objective: "Read files",
          phase: "exploration",
          ownerRole: "explorer",
          roleHints: ["explorer"],
          dependsOn: [],
          requiredInputs: [],
          expectedOutputs: [{ id: "context", kind: "context", description: "selected files" }],
          requiredEvidence: [],
          expectedArtifacts: ["selected files"],
          riskLevel: "low",
          mutationAllowed: false,
          canRunInParallel: false,
          stopIfFails: true,
          acceptanceCriteria: ["files inspected"],
          status: "pending"
        },
        {
          id: "summarize",
          kind: "summarize",
          title: "Summarize",
          objective: "Summarize findings",
          phase: "summary",
          ownerRole: "summarizer",
          roleHints: ["summarizer"],
          dependsOn: ["inspect"],
          requiredInputs: [{ id: "context", kind: "context", description: "selected files", required: true }],
          expectedOutputs: [{ id: "summary", kind: "summary", description: "answer" }],
          requiredEvidence: ["selected files"],
          expectedArtifacts: ["answer"],
          riskLevel: "low",
          mutationAllowed: false,
          canRunInParallel: false,
          stopIfFails: true,
          acceptanceCriteria: ["summary delivered"],
          status: "pending"
        }
      ],
      edges: [{ from: "inspect", to: "summarize", reason: "context before summary" }],
      entryNodeIds: ["inspect"],
      terminalNodeIds: ["summarize"],
      stopConditions: ["summary delivered"],
      riskBoundaries: []
    };
    const normalized = normalizeExternalAgentResponse({
      profile: { id: "claude_code", name: "Claude Code", transport: "mcp", adapter: "claude_code", capabilities: [], allowedRoles: ["planner"], trustLevel: "high" },
      role: "planner",
      outputContract: "plan",
      rawPayload: {
        summary: "planned",
        plan: {
          goal: "inspect repo",
          constraints: [],
          riskLevel: "low",
          taskType: "analysis",
          workflowKind: "read_only",
          steps: [{ id: "inspect", title: "Inspect files", detail: "Read files" }],
          taskGraph,
          debateRecommended: false
        }
      }
    });
    const payload = normalized.payload as { plan?: { taskGraph?: { nodes?: unknown[] } } };

    expect(normalized.status).toBe("success");
    expect(payload.plan?.taskGraph?.nodes).toHaveLength(2);
  });

  it("normalizes Claude judge output with unresolved issue ids", () => {
    const profile = { id: "claude_code", name: "Claude Code", transport: "mcp" as const, adapter: "claude_code" as const, capabilities: [], allowedRoles: ["judge" as const], trustLevel: "high" as const };
    const rawPayload = {
      judgment: {
        decision: "request_revision",
        reason: "blocking issue remains",
        confidence: 0.7,
        unresolvedIssueIds: ["issue_a"]
      }
    };
    const normalized = normalizeExternalAgentResponse({
      profile,
      role: "judge",
      outputContract: "judgment",
      rawPayload
    });
    const payload = normalized.payload as { judgment?: { decision?: string; unresolvedIssueIds?: string[] } };
    const packets = extractExternalAgentEvidencePackets({ profile, role: "judge", outputContract: "judgment", rawPayload, normalized });

    expect(normalized.status).toBe("success");
    expect(payload.judgment?.decision).toBe("request_revision");
    expect(payload.judgment?.unresolvedIssueIds).toEqual(["issue_a"]);
    expect(packets[0]?.supportingArtifacts).toContain("debate_issue:issue_a");
  });

  it("keeps external Codex and Claude evidence packets linked to stable artifact refs", () => {
    const codexProfile = { id: "codex", name: "Codex", transport: "mcp" as const, adapter: "codex" as const, capabilities: [], allowedRoles: ["coder_a", "reviewer"], trustLevel: "high" as const };
    const claudeProfile = { id: "claude_code", name: "Claude Code", transport: "mcp" as const, adapter: "claude_code" as const, capabilities: [], allowedRoles: ["judge"], trustLevel: "high" as const };
    const codexPatch = normalizeExternalAgentResponse({
      profile: codexProfile,
      role: "coder_a",
      outputContract: "patch",
      rawPayload: {
        summary: "patch with ref",
        candidate: {
          candidateId: "codex_patch_ref",
          agentId: "coder_a",
          approach: "minimal_patch",
          summary: "patch with ref",
          filesChanged: ["index.js"],
          unifiedDiff: "--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-a\n+b\n",
          diffRef: "artifacts/diffs/codex.patch",
          testPlan: ["npm test"],
          knownTradeoffs: [],
          estimatedRisk: "low"
        }
      }
    });
    const codexReview = normalizeExternalAgentResponse({
      profile: codexProfile,
      role: "reviewer",
      outputContract: "review",
      rawPayload: {
        summary: "review with ref",
        reviewRef: "artifacts/reviews/codex.json",
        review: { mode: "standard", reviews: [reviewItem("codex_patch_ref", "accept", 90, 10)], overallRecommendation: "accept" }
      }
    });
    const claudeJudge = normalizeExternalAgentResponse({
      profile: claudeProfile,
      role: "judge",
      outputContract: "judgment",
      rawPayload: {
        summary: "judge with ref",
        decisionRef: "artifacts/judge/claude.json",
        judgment: { decision: "select", selectedCandidateId: "codex_patch_ref", reason: "best candidate", confidence: 0.8 }
      }
    });

    expect(extractExternalAgentEvidencePackets({ profile: codexProfile, role: "coder_a", outputContract: "patch", rawPayload: {}, normalized: codexPatch })[0]?.supportingArtifacts).toContain("artifacts/diffs/codex.patch");
    expect(extractExternalAgentEvidencePackets({ profile: codexProfile, role: "reviewer", outputContract: "review", rawPayload: {}, normalized: codexReview })[0]?.supportingArtifacts).toContain("artifacts/reviews/codex.json");
    expect(extractExternalAgentEvidencePackets({ profile: claudeProfile, role: "judge", outputContract: "judgment", rawPayload: {}, normalized: claudeJudge })[0]?.supportingArtifacts).toContain("artifacts/judge/claude.json");
  });

  it("fails strict external adapter output instead of silently accepting malformed role payload", () => {
    const normalized = normalizeExternalAgentResponse({
      profile: { id: "codex", name: "Codex", transport: "mcp", adapter: "codex", strictJson: true, normalizationStrictness: "strict", capabilities: [], allowedRoles: ["coder_a"], trustLevel: "high" },
      role: "coder_a",
      outputContract: "patch",
      rawPayload: "not-json"
    });

    expect(normalized.status).toBe("failed");
    expect(normalized.warnings.join("; ")).toContain("strictJson requested");
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
    trace.contract = { ...trace.contract, riskLevel: "high", reasoningSensitivity: "high" };

    const strictReplay = simulatePolicyOnTrace(strict, trace, base);
    const lightReplay = simulatePolicyOnTrace(light, trace, base);
    const tournament = runPolicyTournament([strict, light], [trace]);

    expect(strictReplay.simulatedStatus).toBe("failure");
    expect(strictReplay.decisions.some((decision) => decision.policyDecision === "judge_required")).toBe(true);
    expect(lightReplay.simulatedStatus).toBe("partial");
    expect(tournament.evaluatedPolicies).toBe(2);
    expect(tournament.winnerPolicyId).toBeTruthy();
  });
});

function reviewItem(candidateId: string, recommendation: "accept" | "revise", correctnessScore: number, riskScore: number) {
  return {
    candidateId,
    correctnessScore,
    riskScore,
    invasiveness: "low" as const,
    testCoverage: "adequate" as const,
    securityConcerns: [],
    regressionConcerns: [],
    redTeamFindings: [],
    recommendation,
    notes: []
  };
}

function patchCandidate(candidateId: string, agentId: "coder_a" | "coder_b", unifiedDiff: string) {
  return {
    candidateId,
    agentId,
    approach: agentId === "coder_b" ? "alternative" as const : "minimal_patch" as const,
    summary: `${candidateId} summary`,
    filesChanged: unifiedDiff ? ["index.js"] : [],
    unifiedDiff,
    testPlan: [],
    knownTradeoffs: [],
    estimatedRisk: "low" as const
  };
}

function debateSessionWithIssues(issues: Array<{ id: string; candidateId?: string; title: string }>): DebateSession {
  const normalizedIssues = issues.map((issue) => ({
    ...issue,
    blocking: true,
    status: "open" as const,
    requiredEvidence: ["evidence"],
    relatedMoveIds: []
  }));
  const globalIssues = normalizedIssues.filter((issue) => !issue.candidateId);
  const candidateIds = [...new Set(normalizedIssues.map((issue) => issue.candidateId).filter((id): id is string => Boolean(id)))];
  return {
    sessionId: "debate_candidate_scope",
    maxRounds: 2,
    moves: [],
    claims: [],
    issues: normalizedIssues,
    unresolvedIssues: normalizedIssues,
    acceptedClaims: [],
    rejectedClaims: [],
    candidateResolutions: Object.fromEntries(candidateIds.map((candidateId) => {
      const candidateIssues = normalizedIssues.filter((issue) => issue.candidateId === candidateId);
      const blocking = [...globalIssues, ...candidateIssues];
      return [candidateId, {
        resolution: blocking.length ? "request_revision" as const : "selectable" as const,
        unresolvedBlockingIssues: blocking.map((issue) => issue.title),
        unresolvedIssues: blocking
      }];
    })),
    globalResolution: {
      resolution: globalIssues.length ? "request_revision" as const : "selectable" as const,
      unresolvedBlockingIssues: globalIssues.map((issue) => issue.title),
      unresolvedIssues: globalIssues
    },
    unresolvedBlockingIssues: globalIssues.map((issue) => issue.title),
    evidenceCoverageScore: 50,
    resolution: globalIssues.length ? "request_revision" : "selectable"
  };
}

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
