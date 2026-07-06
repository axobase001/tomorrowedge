import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { clearContextCaches } from "../../src/core/context/contextCache.js";
import { defaultOrchestrationPolicy } from "../../src/core/orchestrationPolicy/orchestrationPolicy.js";
import { savePolicyScore } from "../../src/core/orchestrationPolicy/policyStore.js";

describe("offline agent graph", () => {
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    delete process.env.MOCK_INPUT_PRICE_PER_MTOK;
    delete process.env.MOCK_OUTPUT_PRICE_PER_MTOK;
    if (originalOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    }
  });

  it("keeps the executor entrypoint as a named phase pipeline", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "core", "agentGraph", "executor.ts"), "utf8");
    const entrypoint = source.slice(source.indexOf("export async function runOfflineGraph"), source.indexOf("function createOfflineGraphRuntime"));
    const lines = entrypoint.split(/\r?\n/).filter((line) => line.trim()).length;

    expect(lines).toBeLessThanOrEqual(55);
    for (const phase of [
      "recordStartupPhase",
      "runRoutingIntentPhase",
      "runExternalCorePhase",
      "runVisionPhase",
      "runContractPhase",
      "runPlanningPhase",
      "runExplorationPhase",
      "runScheduledPatchWorkflow"
    ]) {
      expect(entrypoint).toContain(phase);
      expect(source).toContain(`function ${phase}`);
    }
    for (const scheduledPhase of [
      "runCandidatePhase",
      "runReviewAndJudgePhase",
      "runLiveAdvisoryPhase",
      "runPatchApplicationPhase",
      "runVerificationAndRepairPhase"
    ]) {
      expect(source).toContain(`function ${scheduledPhase}`);
    }
  });

  it("runs without external providers", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test without changing schema", defaultConfig);
    expect(state.plan?.constraints.some((constraint) => constraint.includes("Without"))).toBe(true);
    expect(state.candidates.length).toBe(2);
    expect(state.review).toBeTruthy();
    expect(state.debateRounds.length).toBeGreaterThan(0);
    expect(state.judge?.decision).toBe("request_revision");
    expect(state.finalSummary?.result).toBe("aborted");
    expect(state.finalSummary?.userReply).toContain("did not clear any patch candidate");
    expect(state.finalSummary?.evidence.some((item) => item.includes("Judge requested revision before patch application"))).toBe(true);
    expect(state.events.some((event) => event.type === "evidence_gap" && event.role === "runner")).toBe(false);
    expect(state.evidencePackets.length).toBeGreaterThan(0);
    expect(state.providerViews.length).toBeGreaterThan(0);
    expect(state.traceCompleteness?.score).toBeGreaterThan(0);
    expect(state.scenarioProfile?.scenarioType).toBe("debugging");
    expect(state.objectiveContract?.workflowKind).toBe("patch");
    expect(state.contractVerification?.status).toMatch(/passed|repaired|downgraded/);
    expect(state.objectiveTrace?.outcome.finalStatus).toBeTruthy();
    expect(state.objectiveTrace?.policySummary?.policyId).toBe(state.orchestrationPolicy?.policyId);
    expect(state.objectiveTrace?.traceCompleteness?.score).toBe(state.traceCompleteness?.score);
    expect(state.orchestrationPolicy?.policyId).toBeTruthy();
    expect(state.routing.assignments.some((assignment) => assignment.role === "vision")).toBe(false);
    expect(state.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "scenario_profile",
      "trace_retrieval",
      "objective_contract",
      "contract_verification",
      "orchestration_policy_selected",
      "routing_decision",
      "tool_skill_routing",
      "budget_preview",
      "artifact_projection",
      "context_projection",
      "evidence_packet",
      "workflow_stop_reason",
      "objective_trace_written",
      "orchestration_policy_scored",
      "trace_completeness"
    ]));
  });

  it("applies selected policy genome fields inside the runtime contract and role graph", async () => {
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-runtime-policy-"));
    await cp(source, cwd, { recursive: true });
    const policy = {
      ...defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z"),
      policyId: "runtime_strict_quality",
      contractPolicy: { ...defaultOrchestrationPolicy().contractPolicy, contractDepth: "strict" as const, successCriteriaCount: 5 },
      planningPolicy: { ...defaultOrchestrationPolicy().planningPolicy, maxStepsMode: "conservative" as const, requirePlanStepEvidenceBinding: true },
      routingPolicy: { ...defaultOrchestrationPolicy().routingPolicy, routingPreference: "quality" as const, reviewerThreshold: "low" as const, judgeThreshold: "medium" as const },
      verificationPolicy: { ...defaultOrchestrationPolicy().verificationPolicy, verificationStrictness: "strict" as const },
      stopPolicy: { ...defaultOrchestrationPolicy().stopPolicy, stopMode: "evidence_strict" as const },
      metadata: { ...defaultOrchestrationPolicy().metadata, source: "selected" as const, fitness: 999, scenarioType: "debugging" as const }
    };
    await savePolicyScore(cwd, policy);
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });

      expect(state.orchestrationPolicy?.policyId).toBe("runtime_strict_quality");
      expect(state.objectiveContract?.requiredEvidence).toEqual(expect.arrayContaining(["trace completeness", "objective-action-feedback trace"]));
      expect(state.plan?.steps.length).toBeLessThanOrEqual(6);
      expect(state.plan?.steps.map((step) => step.detail).join("\n")).toContain("Evidence binding:");
      expect(state.roleGraph?.nodes.map((node) => node.role)).toEqual(expect.arrayContaining(["reviewer", "judge"]));
      expect(state.events.some((event) => event.type === "routing_decision" && event.policyTags.includes("policy:quality"))).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("starts alternative coder candidates in the same candidate-production stage", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    const coderA = state.agents.find((agent) => agent.role === "coder_a");
    const coderB = state.agents.find((agent) => agent.role === "coder_b");

    expect(coderA?.status).toBe("success");
    expect(coderB?.status).toBe("success");
    expect(Math.abs(Date.parse(coderA!.startedAt!) - Date.parse(coderB!.startedAt!))).toBeLessThan(50);
    expect(state.candidates.map((candidate) => candidate.agentId).slice(0, 2)).toEqual(["coder_a", "coder_b"]);
    expect(state.agents.map((agent) => agent.role)).toEqual(expect.arrayContaining(["coder_a", "coder_b", "reviewer"]));
    expect(state.agents.findIndex((agent) => agent.role === "coder_a")).toBeLessThan(state.agents.findIndex((agent) => agent.role === "coder_b"));
    expect(state.agents.findIndex((agent) => agent.role === "reviewer")).toBeGreaterThan(state.agents.findIndex((agent) => agent.role === "coder_b"));
  });

  it("executes patch runner and test runner only after RoleGraph and TaskGraph dependencies are terminal", async () => {
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-rolegraph-execution-"));
    await cp(source, cwd, { recursive: true });
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, {
        fixtureMode: true,
        accessMode: "full",
        approvePatch: true,
        approveShell: true,
        testCommand: "node test.js"
      });
      const roleEvents = state.events.filter((event) => event.type === "role_node_result");
      const roleOrder = roleEvents.map((event) => event.nodeId);
      const taskEvents = state.events.filter((event) => event.type === "task_node_result");
      const taskOrder = taskEvents.map((event) => event.taskNodeId);
      const designEvent = taskEvents.find((event) => event.taskNodeId === "design_patch" && event.status === "done");
      const taskNode = (id: string) => state.plan?.taskGraph?.nodes.find((node) => node.id === id);

      expect(roleOrder.indexOf("patch_runner")).toBeGreaterThan(roleOrder.indexOf("judge"));
      expect(roleOrder.indexOf("test_runner")).toBeGreaterThan(roleOrder.indexOf("patch_runner"));
      expect(roleOrder.indexOf("summarizer")).toBeGreaterThan(roleOrder.indexOf("test_runner"));
      expect(taskOrder.indexOf("apply_patch")).toBeGreaterThan(taskOrder.indexOf("judge_patch"));
      expect(taskOrder.indexOf("verify_patch")).toBeGreaterThan(taskOrder.indexOf("apply_patch"));
      expect(taskOrder.indexOf("summarize")).toBeGreaterThan(taskOrder.indexOf("verify_patch"));
      expect(designEvent).toMatchObject({
        artifacts: expect.arrayContaining([expect.stringContaining("designs")]),
        evidenceRef: expect.stringContaining("designs")
      });
      expect(taskNode("design_patch")?.artifactRefs).toEqual(expect.arrayContaining([expect.stringContaining("designs")]));
      expect(taskNode("design_patch")?.evidenceRefs).toEqual(expect.arrayContaining([expect.stringContaining("evidence_packets")]));
      expect(taskNode("review_patch")?.artifactRefs).toEqual(expect.arrayContaining([expect.stringContaining("reviews")]));
      expect(taskNode("review_patch")?.evidenceRefs).toEqual(expect.arrayContaining([expect.stringContaining("evidence_packets")]));
      expect(taskNode("judge_patch")?.artifactRefs).toEqual(expect.arrayContaining([expect.stringContaining("judge_decisions")]));
      expect(taskNode("judge_patch")?.evidenceRefs).toEqual(expect.arrayContaining([expect.stringContaining("evidence_packets")]));
      expect(taskNode("verify_patch")?.artifactRefs).toEqual(expect.arrayContaining([expect.stringContaining("stdout"), expect.stringContaining("stderr")]));
      expect(taskNode("summarize")?.artifactRefs).toEqual(expect.arrayContaining([
        expect.stringContaining("summaries"),
        expect.stringContaining("trace_completeness"),
        expect.stringContaining("objective_traces")
      ]));
      expect(taskNode("summarize")?.evidenceRefs).toEqual(expect.arrayContaining([
        expect.stringContaining("summaries"),
        expect.stringContaining("status_breakdowns"),
        expect.stringContaining("trace_completeness"),
        expect.stringContaining("objective_traces")
      ]));
      expect(state.events.some((event) => event.type === "shell_run" && event.success === true)).toBe(true);
      expect(state.events.some((event) => event.type === "artifact_quality_gate" && event.status === "passed" && event.candidateId === "fixture_candidate_a")).toBe(true);
      expect(state.events.some((event) => event.type === "workflow_status_breakdown" && event.taskAcceptance === "accepted")).toBe(true);
      expect(state.finalSummary?.statusBreakdown).toMatchObject({
        patchApplication: "applied",
        artifactQuality: "passed",
        externalTests: "passed",
        taskAcceptance: "accepted"
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("records high-risk risk_map evidence before security review and passes it to reviewer", async () => {
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-risk-map-"));
    await cp(source, cwd, { recursive: true });
    try {
      const state = await runOfflineGraph(cwd, "fix auth token security bug in the failing test", defaultConfig, { fixtureMode: true });
      const taskEvents = state.events.filter((event) => event.type === "task_node_result");
      const riskMap = taskEvents.find((event) => event.taskNodeId === "risk_map" && event.status === "done");
      const securityReviewIndex = taskEvents.findIndex((event) => event.taskNodeId === "security_review" && event.status === "done");
      const riskMapIndex = taskEvents.findIndex((event) => event.taskNodeId === "risk_map" && event.status === "done");
      const reviewerNotes = state.review?.reviews.flatMap((review) => review.notes) ?? [];

      expect(state.plan?.riskLevel).toBe("high");
      expect(riskMap).toMatchObject({
        artifacts: expect.arrayContaining([expect.stringContaining("risk_maps")]),
        evidenceRef: expect.stringContaining("risk_maps")
      });
      expect(state.plan?.taskGraph?.nodes.find((node) => node.id === "risk_map")?.artifactRefs).toEqual(expect.arrayContaining([expect.stringContaining("risk_maps")]));
      expect(state.plan?.taskGraph?.nodes.find((node) => node.id === "risk_map")?.evidenceRefs).toEqual(expect.arrayContaining([expect.stringContaining("evidence_packets")]));
      expect(riskMapIndex).toBeGreaterThanOrEqual(0);
      expect(securityReviewIndex).toBeGreaterThan(riskMapIndex);
      expect(reviewerNotes).toContain("Risk map evidence visible to reviewer: 1.");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("honors planningPolicy.allowParallelRoles=false in the runtime candidate and debate path", async () => {
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-no-parallel-policy-"));
    await cp(source, cwd, { recursive: true });
    const base = defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z");
    await savePolicyScore(cwd, {
      ...base,
      policyId: "no_parallel_roles",
      planningPolicy: { ...base.planningPolicy, allowParallelRoles: false },
      metadata: { ...base.metadata, source: "selected" as const, fitness: 999, scenarioType: "debugging" as const }
    });
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });

      expect(state.orchestrationPolicy?.policyId).toBe("no_parallel_roles");
      expect(state.plan?.debateRecommended).toBe(false);
      expect(state.candidates.map((candidate) => candidate.agentId)).not.toContain("coder_b");
      expect(state.agents.map((agent) => agent.role)).not.toContain("coder_b");
      expect(state.roleGraph?.nodes.map((node) => node.role)).not.toContain("coder_b");
      expect(state.debateRounds).toHaveLength(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("classifies approval-blocked verification as blockedByApproval instead of ordinary missing shell evidence", async () => {
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-approval-trace-"));
    await cp(source, cwd, { recursive: true });
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
      const completenessEvent = state.events.find((event) => event.type === "trace_completeness");

      expect(state.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "role_node_result", nodeId: "patch_runner", status: "skipped" }),
        expect.objectContaining({ type: "role_node_result", nodeId: "test_runner", status: "skipped" })
      ]));
      expect(state.traceCompleteness?.missing).not.toContain("shell run recorded");
      expect(state.traceCompleteness?.blockedByApproval).toContain("shell run recorded");
      expect(state.finalSummary?.evidence.join("\n")).toContain("patch_runner skipped");
      expect(state.finalSummary?.evidence.join("\n")).toContain("test_runner skipped");
      expect(completenessEvent).toMatchObject({
        blockedByApproval: expect.arrayContaining(["shell run recorded"])
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("applies selected routingPreference to runtime route assignments", async () => {
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-policy-routing-"));
    await cp(source, cwd, { recursive: true });
    const base = defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z");
    await savePolicyScore(cwd, {
      ...base,
      policyId: "cheap_policy_route",
      routingPolicy: { ...base.routingPolicy, routingPreference: "cheap" },
      metadata: { ...base.metadata, source: "selected" as const, fitness: 999, scenarioType: "debugging" as const }
    });
    const config = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openrouter: { ...defaultConfig.providers.openrouter, enabled: true, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" },
        deepseek: { ...defaultConfig.providers.deepseek, enabled: true, api_key_env: "DEEPSEEK_API_KEY", base_url: "https://api.deepseek.com" }
      }
    };
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", config, { fixtureMode: true });

      expect(state.orchestrationPolicy?.policyId).toBe("cheap_policy_route");
      expect(state.routing.assignments.find((assignment) => assignment.role === "planner")?.provider).toBe("deepseek");
      expect(state.events.some((event) =>
        event.type === "routing_decision"
        && event.phase === "planning"
        && event.role === "planner"
        && event.assignedProvider === "deepseek"
        && event.policyTags.includes("policy:cheap")
      )).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps planner semantic routing model-backed while reusing explorer results", async () => {
    clearContextCaches();
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-context-cache-"));
    await cp(source, cwd, { recursive: true });
    try {
      await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
      const second = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
      await writeFile(path.join(cwd, "index.js"), "export function add(a, b) { return a + b; }\n// cache invalidation\n", "utf8");
      const third = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });

      expect(second.events).toContainEqual(expect.objectContaining({ type: "agent_cache", cache: "planner", status: "miss" }));
      expect(second.events).toContainEqual(expect.objectContaining({ type: "agent_cache", cache: "explorer", status: "hit" }));
      expect(third.events).toContainEqual(expect.objectContaining({ type: "agent_cache", cache: "planner", status: "miss" }));
      expect(third.events).toContainEqual(expect.objectContaining({ type: "agent_cache", cache: "explorer", status: "miss" }));
      expect(second.events.some((event) => event.type === "model_call" && event.role === "planner")).toBe(true);
    } finally {
      clearContextCaches();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps read-only directory inspection out of patch approval", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-readonly-"));
    await mkdir(path.join(cwd, "quantum", "src"), { recursive: true });
    await writeFile(path.join(cwd, "quantum", "README.md"), "# Quantum\n", "utf8");
    await writeFile(path.join(cwd, "quantum", "src", "index.ts"), "export const value = 1;\n", "utf8");
    try {
      const state = await runOfflineGraph(cwd, "读取 quantum 文件夹内容，输出文件结构", defaultConfig, { fixtureMode: true });
      const eventTypes = state.events.map((event) => event.type);

      expect(state.plan?.taskType).toBe("analysis");
      expect(state.finalSummary?.result).toBe("completed");
      expect(state.finalSummary?.evidence.join("\n")).toContain("quantum/");
      expect(state.finalSummary?.evidence.join("\n")).toContain("src/");
      expect(state.events.find((event) => event.type === "workflow_intent")).toMatchObject({
        intent: "inspect",
        requiresPatchWorkflow: false
      });
      expect(state.candidates).toEqual([]);
      expect(state.review).toBeUndefined();
      expect(state.judge).toBeUndefined();
      expect(state.agents.some((agent) => agent.status === "waiting_for_user")).toBe(false);
      expect(eventTypes).toContain("context_select");
      expect(eventTypes).not.toContain("patch_candidate");
      expect(eventTypes).not.toContain("review_decision");
      expect(eventTypes).not.toContain("judge_decision");
      expect(eventTypes).not.toContain("patch_apply");
      expect(eventTypes).not.toContain("shell_run");
      const taskEvents = state.events.filter((event) => event.type === "task_node_result");
      const taskOrder = taskEvents.map((event) => event.taskNodeId);
      const summarizeNode = state.plan?.taskGraph?.nodes.find((node) => node.id === "summarize_findings");
      expect(taskOrder.indexOf("summarize_findings")).toBeGreaterThan(taskOrder.indexOf("inspect_context"));
      expect(summarizeNode?.artifactRefs).toEqual(expect.arrayContaining([
        expect.stringContaining("summaries"),
        expect.stringContaining("trace_completeness"),
        expect.stringContaining("objective_traces")
      ]));
      expect(summarizeNode?.evidenceRefs).toEqual(expect.arrayContaining([
        expect.stringContaining("summaries"),
        expect.stringContaining("trace_completeness"),
        expect.stringContaining("objective_traces")
      ]));
      expect(state.events.find((event) => event.type === "workflow_stop_reason")).toMatchObject({
        reason: "read-only request completed without patch workflow"
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns a user-facing reply for a simple conversational prompt", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "hello", defaultConfig);

    expect(state.finalSummary?.result).toBe("completed");
    expect(state.finalSummary?.userReplySource).toBe("model");
    expect(state.finalSummary?.userReply).toContain("Mock provider response");
    expect(state.finalSummary?.userReply).not.toContain("Read-only request completed without patch generation.");
    expect(state.events.some((event) => event.type === "model_call" && event.role === "summarizer" && event.status === "success")).toBe(true);
    expect(state.candidates).toEqual([]);
  });

  it("returns a user-facing answer for general knowledge read-only questions", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "prove that a finite division ring is a field", defaultConfig);

    expect(state.finalSummary?.result).toBe("completed");
    expect(state.finalSummary?.userReplySource).toBe("model");
    expect(state.finalSummary?.userReply).toContain("Mock provider response");
    expect(state.finalSummary?.userReply).not.toContain("A finite division ring is a field.");
    expect(state.finalSummary?.userReply).not.toContain("Selected context:");
    expect(state.events.some((event) => event.type === "model_call" && event.role === "summarizer" && event.status === "success")).toBe(true);
    expect(state.candidates).toEqual([]);
  });

  it("returns a user-facing repository summary for read-only repo questions", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "summarize this repository without editing files", defaultConfig, { fixtureMode: true });

    expect(state.finalSummary?.result).toBe("completed");
    expect(state.finalSummary?.userReplySource).toBe("model");
    expect(state.finalSummary?.userReply).toContain("Mock provider response");
    expect(state.finalSummary?.userReply).not.toContain("I completed a read-only pass");
    expect(state.finalSummary?.userReply).not.toContain("Result:");
    expect(state.finalSummary?.evidence.join("\n")).toContain("No file writes");
    expect(state.candidates).toEqual([]);
  });

  it("blocks read-only user replies when the configured answer model is unavailable instead of falling back", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openrouter: { ...defaultConfig.providers.openrouter, enabled: false, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" }
      },
      agents: {
        ...defaultConfig.agents,
        summarizer: { provider: "openrouter", model: "openai/gpt-5.2", reason: "test unavailable answer model" }
      }
    };
    const state = await runOfflineGraph(cwd, "summarize this repository without editing files", config, { fixtureMode: true });

    expect(state.finalSummary?.result).toBe("failed");
    expect(state.finalSummary?.userReplySource).toBe("blocked");
    expect(state.finalSummary?.userReply).toContain("No model-backed user answer was produced.");
    expect(state.events.some((event) => event.type === "model_call" && event.role === "summarizer" && event.provider === "openrouter" && event.status === "failure")).toBe(true);
    expect(state.events.some((event) => event.type === "model_call" && event.role === "summarizer" && event.provider === "mock" && event.status === "success")).toBe(false);
    expect(state.events.some((event) => event.type === "provider_fallback" && event.role === "summarizer")).toBe(false);
    expect(state.events.find((event) => event.type === "workflow_stop_reason")).toMatchObject({
      reason: "model-backed answer unavailable; workflow blocked without fallback"
    });
  });

  it("keeps natural-language inspect requests from becoming fake missing paths", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "inspect provider setup flow for actionable bug; do not edit files", defaultConfig, { fixtureMode: true });
    const evidence = state.finalSummary?.evidence.join("\n") ?? "";

    expect(state.plan?.taskType).toBe("analysis");
    expect(state.objectiveContract?.workflowKind).toBe("read_only");
    expect(state.finalSummary?.result).toBe("completed");
    expect(evidence).toContain("Read-only request completed without patch generation.");
    expect(evidence).not.toContain(`${cwd}${path.sep}provider`);
    expect(evidence).not.toContain("Unable to inspect target");
    expect(evidence).not.toContain("ENOENT");
    expect(state.candidates).toEqual([]);
  });

  it("honors explicit Chinese no-edit and no-shell instructions as read-only", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(
      cwd,
      "审查当前仓库 README.md 和 package.json 中的版本说明是否一致；只输出诊断和建议，不要修改文件，也不要运行命令。",
      defaultConfig,
      { fixtureMode: true }
    );
    const eventTypes = state.events.map((event) => event.type);

    expect(state.workflowKind).toBe("read_only");
    expect(state.objectiveContract?.workflowKind).toBe("read_only");
    expect(state.objectiveContract?.allowedTools).not.toEqual(expect.arrayContaining(["patch_apply", "shell", "undo"]));
    expect(state.objectiveContract?.forbiddenActions).toEqual(expect.arrayContaining(["write_files", "apply_patch", "run_shell"]));
    expect(state.candidates).toEqual([]);
    expect(state.review).toBeUndefined();
    expect(state.judge).toBeUndefined();
    expect(eventTypes).not.toContain("patch_candidate");
    expect(eventTypes).not.toContain("shell_run");
  });

  it("separates configured cloud route proposals from native offline execution", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      debate: { ...defaultConfig.debate, max_candidates: 1 },
      providers: {
        ...defaultConfig.providers,
        deepseek: {
          ...defaultConfig.providers.deepseek,
          enabled: true,
          base_url: "https://api.deepseek.example/v1",
          api_key_env: "",
          auth_header: "none" as const
        }
      },
      agents: {
        ...defaultConfig.agents,
        planner: { provider: "deepseek", model: "deepseek-v4-pro" },
        coder_a: { provider: "deepseek", model: "deepseek-v4-pro" },
        reviewer: { provider: "deepseek", model: "deepseek-v4-pro" },
        judge: { provider: "deepseek", model: "deepseek-v4-pro" }
      }
    };

    const state = await runOfflineGraph(cwd, "fix failing test", config, { fixtureMode: true });
    const agentKinds = new Map(state.agents.map((agent) => [agent.role, agent.agentKind]));
    const plannerRoute = state.routing.assignments.find((assignment) => assignment.role === "planner");
    expect(plannerRoute).toMatchObject({ provider: "deepseek", model: "deepseek-v4-pro" });
    expect(agentKinds.get("planner")).toBeUndefined();
    expect(state.events.some((event) => event.type === "model_call" && event.role === "planner" && event.provider === "mock")).toBe(true);
    expect(agentKinds.get("coder_a")).toBe("offline");
    expect(agentKinds.get("reviewer")).toBe("offline");
    expect(agentKinds.get("judge")).toBe("offline");
    expect(state.events.find((event) => event.type === "agent_run" && event.role === "planner")).toBeUndefined();
  });

  it("lets configured external MCP agents execute core-led workflow roles", async () => {
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-external-core-"));
    await cp(source, cwd, { recursive: true });
    const config = {
      ...defaultConfig,
      debate: { ...defaultConfig.debate, max_candidates: 1 },
      strong_agents: { ...defaultConfig.strong_agents, max_calls_per_task: 8 },
      external_agents: {
        ...defaultConfig.external_agents,
        codex: {
          ...defaultConfig.external_agents.codex,
          enabled: true,
          command: process.execPath,
          args: [path.join(process.cwd(), "tests", "fixtures", "mock-role-external-mcp-server.mjs")],
          autoStart: true,
          roles: ["core", "coder_a", "reviewer", "judge"],
          capabilities: ["core", "coding", "review", "judgment"],
          requestTimeoutMs: 10_000
        }
      },
      agents: {
        ...defaultConfig.agents,
        core: { provider: "external:codex", model: "auto" },
        coder_a: { provider: "external:codex", model: "auto" },
        reviewer: { provider: "external:codex", model: "auto" },
        judge: { provider: "external:codex", model: "auto" }
      }
    };

    try {
      const state = await runOfflineGraph(cwd, "fix failing test", config, {
        accessMode: "partial",
        approvePatch: true,
        approveShell: true,
        testCommand: "node test.js"
      });

      expect(state.agents.filter((agent) => agent.provider === "external:codex").map((agent) => agent.role)).toEqual(expect.arrayContaining(["core", "coder_a", "reviewer", "judge"]));
      expect(state.candidates[0]?.candidateId).toBe("external_codex_patch");
      expect(state.review?.overallRecommendation).toContain("External reviewer accepts");
      expect(state.judge?.selectedCandidateId).toBe("external_codex_patch");
      expect(state.changedFiles).toEqual(["index.js"]);
      expect(state.runResults[0]?.success).toBe(true);
      expect(state.events.map((event) => event.type)).toEqual(expect.arrayContaining(["external_agent_call", "external_agent_result", "patch_apply", "shell_run"]));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 15_000);

  it("blocks external core invocation in restricted access mode", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      external_agents: {
        ...defaultConfig.external_agents,
        codex: {
          ...defaultConfig.external_agents.codex,
          enabled: true,
          command: process.execPath,
          args: [path.join(process.cwd(), "tests", "fixtures", "mock-role-external-mcp-server.mjs")],
          autoStart: true,
          roles: ["core"],
          capabilities: ["core"],
          requestTimeoutMs: 10_000
        }
      },
      agents: {
        ...defaultConfig.agents,
        core: { provider: "external:codex", model: "auto" }
      }
    };

    const state = await runOfflineGraph(cwd, "fix failing test", config, {
      accessMode: "restricted"
    });

    expect(state.events.some((event) => event.type === "external_agent_call" && event.role === "core")).toBe(false);
    expect(state.events).toContainEqual(expect.objectContaining({
      type: "agent_run",
      role: "core",
      provider: "external:codex",
      status: "blocked"
    }));
    expect(state.events).toContainEqual(expect.objectContaining({
      type: "autonomy_limit_reached",
      role: "core",
      status: "blocked_by_access_mode"
    }));
  });

  it("enforces external allowedRoles before executing a routed role", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      debate: { ...defaultConfig.debate, max_candidates: 1 },
      external_agents: {
        ...defaultConfig.external_agents,
        codex: {
          ...defaultConfig.external_agents.codex,
          enabled: true,
          command: process.execPath,
          args: [path.join(process.cwd(), "tests", "fixtures", "mock-role-external-mcp-server.mjs")],
          autoStart: true,
          roles: ["reviewer"],
          capabilities: ["review"],
          requestTimeoutMs: 10_000
        }
      },
      agents: {
        ...defaultConfig.agents,
        coder_a: { provider: "external:codex", model: "auto" }
      }
    };

    const state = await runOfflineGraph(cwd, "fix failing test", config);

    expect(state.events.some((event) => event.type === "external_agent_call" && event.role === "coder_a")).toBe(false);
    expect(state.agents.find((agent) => agent.role === "coder_a")).toMatchObject({
      provider: "local_tool",
      model: "native_coder_a",
      agentKind: "offline",
      status: "success"
    });
    expect(state.candidates[0]?.agentId).toBe("coder_a");
  });

  it("records unparseable strict external role payloads before aborting without native fallback", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      external_agents: {
        ...defaultConfig.external_agents,
        codex: {
          ...defaultConfig.external_agents.codex,
          enabled: true,
          command: process.execPath,
          args: [path.join(process.cwd(), "tests", "fixtures", "mock-role-external-mcp-server.mjs")],
          env: { TOMORROWEDGE_UNPARSEABLE_ROLE: "reviewer" },
          autoStart: true,
          roles: ["reviewer"],
          capabilities: ["review"],
          requestTimeoutMs: 10_000
        }
      },
      agents: {
        ...defaultConfig.agents,
        reviewer: { provider: "external:codex", model: "auto" }
      }
    };

    const state = await runOfflineGraph(cwd, "fix failing test", config);
    const normalizationEvent = state.events.find((event) => event.type === "external_agent_normalization" && event.role === "reviewer");
    const errorEvent = state.events.find((event) => event.type === "external_agent_error" && event.role === "reviewer");

    expect(state.finalSummary?.result).toBe("aborted");
    expect(state.review).toBeUndefined();
    expect(normalizationEvent).toMatchObject({ status: "failed" });
    expect(errorEvent).toBeTruthy();
    expect(errorEvent && "error" in errorEvent ? errorEvent.error : "").toContain("normalization");
    expect(state.events.some((event) => event.type === "fallback_to_native" && event.role === "reviewer")).toBe(false);
  });

  it("records live advisory notes without changing deterministic decisions", async () => {
    delete process.env.MOCK_INPUT_PRICE_PER_MTOK;
    delete process.env.MOCK_OUTPUT_PRICE_PER_MTOK;
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      strong_agents: {
        ...defaultConfig.strong_agents,
        max_calls_per_task: 10,
        max_cost_usd: 10
      }
    };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { liveAdvisory: true });

    expect(state.modelNotes.map((note) => note.kind)).toEqual(["review_advice", "judge_advice", "plan_advice", "implementation_advice", "review_advice", "judge_advice"]);
    expect(state.modelNotes.every((note) => note.provider === "mock")).toBe(true);
    expect(state.debateRounds.some((round) => round.speaker === "reviewer" && round.evidence.some((item) => item.includes("direct model stance")))).toBe(true);
    expect(state.debateRounds.some((round) => round.speaker === "judge" && round.evidence.some((item) => item.includes("direct model stance")))).toBe(true);
    expect(state.usageSummary.totalTokens).toBeGreaterThan(0);
    expect(state.changedFiles).toEqual([]);
    expect(state.events.some((event) => event.type === "budget_decision" && event.role === "planner" && event.status !== "blocked")).toBe(true);
  });

  it("includes direct provider model_call usage in the workflow usage summary", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, {
      fixtureMode: true
    });
    const successfulModelCalls = state.events.filter((event) => event.type === "model_call" && event.status === "success" && event.inputTokens);

    expect(successfulModelCalls.length).toBeGreaterThan(0);
    expect(state.usageSummary.totalTokens).toBeGreaterThan(0);
    expect(state.events).toContainEqual(expect.objectContaining({
      type: "cost_usage",
      totalTokens: expect.any(Number)
    }));
  });

  it("records routing max-cost preflight as an estimate while BudgetGate governs live advisory invocation", async () => {
    process.env.MOCK_INPUT_PRICE_PER_MTOK = "1000";
    process.env.MOCK_OUTPUT_PRICE_PER_MTOK = "1000";
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      routing: { ...defaultConfig.routing, max_cost_usd: 0.001 },
      strong_agents: { ...defaultConfig.strong_agents, max_calls_per_task: 8, max_cost_usd: 100 }
    };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { liveAdvisory: true });

    expect(state.budgetStatus?.status).toBe("blocked");
    expect(state.budgetStatuses.map((status) => status.status)).toContain("blocked");
    expect(state.modelNotes.length).toBeGreaterThan(0);
    expect(state.usageSummary.totalTokens).toBeGreaterThan(0);
    expect(state.events.some((event) => event.type === "budget_decision" && event.invocationKind === "live_advisory" && event.status === "allowed")).toBe(true);
    expect(state.events.some((event) => event.type === "budget_decision" && event.invocationKind === "live_advisory" && event.simulated)).toBe(true);
  });

  it("restricted access blocks live advisory before cloud/model calls", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, {
      liveAdvisory: true,
      accessMode: "restricted"
    });

    expect(state.access.cloudAllowed).toBe(false);
    expect(state.events.some((event) => event.type === "autonomy_limit_reached" && event.reason.includes("Live advisory blocked"))).toBe(true);
    expect(state.modelNotes).toEqual([]);
  });

  it("falls back to mock when a routed live advisory provider is unavailable", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openrouter: { ...defaultConfig.providers.openrouter, enabled: true, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" }
      },
      agents: {
        ...defaultConfig.agents,
        planner: { provider: "mock", model: "mock-balanced" },
        reviewer: { provider: "openrouter", model: "openai/gpt-5.2" },
        judge: { provider: "openrouter", model: "openai/gpt-5.2" }
      }
    };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { liveAdvisory: true });

    expect(state.routing.assignments.find((assignment) => assignment.role === "reviewer")?.provider).toBe("openrouter");
    expect(state.modelNotes.length).toBeGreaterThan(0);
    expect(state.modelNotes.every((note) => note.provider === "mock")).toBe(true);
    expect(state.debateRounds.some((round) => round.speaker === "reviewer" && round.evidence.some((item) => item.includes("provider=mock/")))).toBe(true);
    expect(state.debateRounds.some((round) => round.speaker === "judge" && round.evidence.some((item) => item.includes("provider=mock/")))).toBe(true);
    expect(state.modelNotes.every((note) => note.fallbackUsed)).toBe(true);
    expect(state.modelNotes.every((note) => note.fallbackFrom?.provider === "openrouter")).toBe(true);
    expect(state.events.some((event) => event.type === "provider_fallback")).toBe(true);
    expect(state.events.some((event) => event.type === "model_call" && event.status === "start" && event.provider === "openrouter")).toBe(true);
    expect(state.events.some((event) => event.type === "model_call" && event.status === "failure" && event.provider === "openrouter")).toBe(true);
    expect(state.events.some((event) => event.type === "model_call" && event.status === "success" && event.provider === "mock")).toBe(true);
  });

  it("surfaces unavailable provider errors when routing fallback is disabled", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      routing: { ...defaultConfig.routing, fallback: false },
      providers: {
        ...defaultConfig.providers,
        openrouter: { ...defaultConfig.providers.openrouter, enabled: true, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" }
      },
      agents: {
        ...defaultConfig.agents,
        planner: { provider: "mock", model: "mock-balanced" },
        reviewer: { provider: "openrouter", model: "openai/gpt-5.2" },
        judge: { provider: "openrouter", model: "openai/gpt-5.2" }
      }
    };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { liveAdvisory: true });

    const errorNotes = state.modelNotes.filter((note) => note.error);
    expect(errorNotes.length).toBeGreaterThan(0);
    expect(errorNotes.every((note) => note.provider === "openrouter")).toBe(true);
    expect(errorNotes.every((note) => note.fallbackUsed !== true)).toBe(true);
    expect(errorNotes.every((note) => note.error?.includes("not configured"))).toBe(true);
  });

  it("records live patch candidate attempts without applying them", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { livePatch: true });

    expect(state.candidates).toHaveLength(2);
    expect(state.candidates.every((candidate) => candidate.candidateId.startsWith("live_"))).toBe(true);
    expect(state.candidates.every((candidate) => !candidate.summary.includes("[MOCK]"))).toBe(true);
    expect(state.modelNotes.filter((note) => note.kind === "patch_generation").length).toBe(2);
    expect(state.changedFiles).toEqual([]);
    expect(state.events.some((event) => event.type === "budget_decision" && event.role === "coder_a" && event.phase === "coding")).toBe(true);
      expect(state.events.some((event) => event.type === "budget_decision" && event.role === "coder_b" && event.phase === "coding")).toBe(true);
      expect(state.budgetRuntime.simulatedStrongAgentCallsUsed).toBeGreaterThan(0);
      expect(state.budgetRuntime.realStrongAgentCallsUsed).toBe(0);
  });

  it("blocks the live patch coder node when no valid candidates remain", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            summary: "Unsafe env edit.",
            filesChanged: [".env"],
            unifiedDiff: "--- a/.env\n+++ b/.env\n@@ -0,0 +1 @@\n+SECRET=1\n",
            testPlan: ["npm test"],
            knownTradeoffs: ["touches ignored secret material"],
            estimatedRisk: "low"
          })
        }
      }],
      usage: { prompt_tokens: 10, completion_tokens: 10 }
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const config = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openai_compatible: {
          ...defaultConfig.providers.openai_compatible,
          enabled: true,
          api_key_env: "",
          base_url: "http://provider.test/v1",
          model: "live-test-model",
          auth_header: "none" as const
        }
      },
      agents: {
        ...defaultConfig.agents,
        coder_a: { provider: "openai_compatible", model: "live-test-model" },
        coder_b: { provider: "openai_compatible", model: "live-test-model" }
      }
    };
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", config, { fixtureMode: true, livePatch: true });

      expect(state.candidates).toEqual([]);
      expect(state.roleGraphExecution?.nodes.coder_a?.status).toBe("blocked");
      expect(state.roleGraphExecution?.results).toContainEqual(expect.objectContaining({
        role: "coder_a",
        status: "blocked",
        summary: "live patch produced no valid candidates"
      }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("blocks live patch through the unified model invocation budget gate", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      strong_agents: { ...defaultConfig.strong_agents, max_calls_per_task: 2 }
    };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { livePatch: true, accessMode: "full" });

    expect(state.events).toContainEqual(expect.objectContaining({
      type: "budget_decision",
      invocationKind: "live_patch",
      status: "blocked"
    }));
    expect(state.budgetRuntime.strongAgentCallsUsed).toBe(2);
  });

  it("blocks live advisory through the unified model invocation budget gate", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      strong_agents: { ...defaultConfig.strong_agents, max_calls_per_task: 4 }
    };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { liveAdvisory: true, accessMode: "full" });

    expect(state.events).toContainEqual(expect.objectContaining({
      type: "budget_decision",
      invocationKind: "live_advisory",
      status: "blocked"
    }));
    expect(state.budgetRuntime.strongAgentCallsUsed).toBe(4);
  });

  it("blocks pre-judge model debate through the unified model invocation budget gate", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      strong_agents: { ...defaultConfig.strong_agents, max_calls_per_task: 2 }
    };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { liveAdvisory: true, accessMode: "full" });

    expect(state.events).toContainEqual(expect.objectContaining({
      type: "budget_decision",
      invocationKind: "pre_judge_debate",
      status: "blocked"
    }));
    expect(state.budgetRuntime.strongAgentCallsUsed).toBe(2);
  });

  it("routes model planner and task governance through the unified model invocation budget gate", async () => {
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-budget-gate-"));
    try {
      await cp(source, cwd, { recursive: true });
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });

      expect(state.events).toContainEqual(expect.objectContaining({
        type: "budget_decision",
        invocationKind: "model_planner",
        status: "allowed"
      }));
      expect(state.events).toContainEqual(expect.objectContaining({
        type: "budget_decision",
        invocationKind: "task_governance",
        status: "allowed"
      }));
      expect(state.budgetRuntime.strongAgentCallsUsed).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("blocks task governance model calls when the strong-agent call budget is exhausted", async () => {
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-budget-gate-blocked-"));
    const config = {
      ...defaultConfig,
      strong_agents: { ...defaultConfig.strong_agents, max_calls_per_task: 1 }
    };
    try {
      await cp(source, cwd, { recursive: true });
      const state = await runOfflineGraph(cwd, "fix failing test", config, { fixtureMode: true });

      expect(state.events).toContainEqual(expect.objectContaining({
        type: "budget_decision",
        invocationKind: "model_planner",
        status: "allowed"
      }));
      expect(state.events).toContainEqual(expect.objectContaining({
        type: "budget_decision",
        invocationKind: "task_governance",
        status: "blocked"
      }));
      expect(state.budgetRuntime.strongAgentCallsUsed).toBe(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("skips duplicate post-judge live advisory when live patch already selected a candidate", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "Fix add implementation.",
              filesChanged: ["index.js"],
              unifiedDiff: "--- a/index.js\n+++ b/index.js\n@@ -1,5 +1,5 @@\n export function add(a, b) {\n-  return a - b;\n+  return a + b;\n }\n \n export default add;\n",
              testPlan: ["npm test"],
              knownTradeoffs: [],
              estimatedRisk: "low"
            })
          }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10 }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const config = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openai_compatible: {
          ...defaultConfig.providers.openai_compatible,
          enabled: true,
          api_key_env: "",
          base_url: "http://provider.test/v1",
          model: "live-test-model",
          auth_header: "none" as const
        }
      },
      agents: {
        ...defaultConfig.agents,
        coder_a: { provider: "openai_compatible", model: "live-test-model" },
        coder_b: { provider: "openai_compatible", model: "live-test-model" }
      }
    };
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", config, { fixtureMode: true, livePatch: true, liveAdvisory: true });

      expect(calls).toBeGreaterThanOrEqual(2);
      expect(state.judge?.decision).toBe("select");
      expect(state.candidates.every((candidate) => candidate.candidateId.startsWith("live_"))).toBe(true);
      expect(state.modelNotes.filter((note) => note.kind === "plan_advice" || note.kind === "implementation_advice")).toEqual([]);
      expect(state.events.some((event) => event.type === "evidence_update" && event.evidence.some((item) => item.includes("post-judge live advisory skipped")))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("restricted access blocks live patch generation", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { livePatch: true, accessMode: "restricted" });

    expect(state.events.some((event) => event.type === "autonomy_limit_reached" && event.reason.includes("Live patch generation blocked"))).toBe(true);
    expect(state.modelNotes.filter((note) => note.kind === "patch_generation")).toEqual([]);
  });

  it("inserts a vision handoff when image inputs are provided", async () => {
    const cwd = path.join(os.tmpdir(), `tedge-vision-${Date.now()}`);
    const imagePath = path.join(cwd, "login-screen.png");
    try {
      await mkdir(cwd, { recursive: true });
      await writeFile(imagePath, "fake image bytes", "utf8");
      const state = await runOfflineGraph(cwd, "restore this mobile login React page from screenshot", defaultConfig, {
        imagePaths: [imagePath]
      });

      expect(state.agents[0].role).toBe("vision");
      expect(state.capabilityRoute?.trigger).toBe("image_input");
      expect(state.capabilityRoute?.steps.map((step) => step.role)).toContain("vision");
      expect(state.visualSpec?.pageType).toBe("ui_screen");
      expect(state.visualSpec?.handoffPrompt).toContain("Visual Spec");
      expect(state.capabilityRoute?.steps.find((step) => step.role === "planner")?.status).toBe("success");
      expect(state.capabilityRoute?.steps.find((step) => step.role === "coder_a")?.status).toBe("success");
      expect(state.capabilityRoute?.steps.find((step) => step.role === "reviewer")?.status).toBe("success");
      expect(state.finalSummary?.evidence.some((item) => item.includes(state.visualSpec?.summary ?? ""))).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps a visual handoff when live vision cannot produce structured JSON", async () => {
    const cwd = path.join(os.tmpdir(), `tedge-live-vision-${Date.now()}`);
    const imagePath = path.join(cwd, "error.png");
    try {
      await mkdir(cwd, { recursive: true });
      await writeFile(imagePath, "fake image bytes", "utf8");
      const state = await runOfflineGraph(cwd, "fix the bug shown in this error screenshot", defaultConfig, {
        imagePaths: [imagePath],
        liveVision: true
      });

      expect(state.modelNotes.some((note) => note.kind === "vision_spec")).toBe(true);
      expect(state.visualSpec?.pageType).toBe("error_screenshot");
      expect(state.capabilityRoute?.steps.find((step) => step.role === "vision")?.status).toBe("success");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fails before visual handoff when image input is missing", async () => {
    const cwd = path.join(os.tmpdir(), `tedge-live-vision-missing-${Date.now()}`);
    const imagePath = path.join(cwd, "missing-error.png");
    try {
      await mkdir(cwd, { recursive: true });
      await expect(runOfflineGraph(cwd, "fix the bug shown in this error screenshot", defaultConfig, {
        imagePaths: [imagePath],
        liveVision: true
      })).rejects.toThrow("Image input not found");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("includes image inputs in live vision budget preflight", async () => {
    process.env.MOCK_INPUT_PRICE_PER_MTOK = "1000";
    process.env.MOCK_OUTPUT_PRICE_PER_MTOK = "1000";
    const cwd = path.join(os.tmpdir(), `tedge-live-vision-budget-${Date.now()}`);
    const imagePath = path.join(cwd, "screen.png");
    try {
      await mkdir(cwd, { recursive: true });
      await writeFile(imagePath, "fake image bytes", "utf8");
      const config = { ...defaultConfig, routing: { ...defaultConfig.routing, max_cost_usd: 0.001 } };
      const state = await runOfflineGraph(cwd, "restore this page from screenshot", config, {
        imagePaths: [imagePath],
        liveVision: true
      });

      expect(state.budgetStatus?.status).toBe("blocked");
      expect(state.budgetStatuses.some((status) => status.status === "blocked" && (status.estimatedInputTokens ?? 0) > 1000)).toBe(true);
      expect(state.modelNotes.find((note) => note.kind === "vision_spec")).toBeUndefined();
      expect(state.visualSpec?.pageType).toBe("ui_screen");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
