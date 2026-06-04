import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/configLoader.js";
import type { AccessMode, TomorrowEdgeConfig } from "../config/schema.js";
import { buildAccessPolicy } from "../core/permissions/accessPolicy.js";
import { ModelRouter } from "../core/routing/router.js";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import { EventLedger } from "../core/events/eventLedger.js";
import { renderEventMarkdown } from "../core/events/eventRenderer.js";
import type { TomorrowEdgeEvent } from "../core/events/eventTypes.js";
import { externalAgentRegistryFromConfig, ExternalAgentRegistry } from "../core/externalAgents/externalAgentRegistry.js";
import type { ExternalAgentProfile, ExternalAgentRegistrationInput } from "../core/externalAgents/externalAgentTypes.js";
import { externalAgentIdFromProvider } from "../core/externalAgents/externalAgentRouter.js";
import { ExternalAgentProcessClient, probeExternalAgent } from "../core/externalAgents/externalAgentProcess.js";
import { runCommandExternalAgent } from "../core/externalAgents/runners/commandExternalAgentRunner.js";
import { loadLatestSession, loadSession, type SessionRecord } from "../core/memory/sessionMemory.js";
import { agentRoles, type AgentRole, type AgentRunState } from "../schemas/agentTask.js";
import type { JudgeDecision } from "../schemas/judge.js";
import type { PatchCandidate } from "../schemas/patchCandidate.js";
import type { ReviewReport } from "../schemas/review.js";
import { makeId } from "../utils/ids.js";

export type StartWorkflowInput = {
  goal: string;
  accessMode?: AccessMode;
};

export type WorkflowRef = {
  sessionId?: string;
};

export class TomorrowEdgeMcpBridge {
  private readonly config: TomorrowEdgeConfig;
  private readonly registry: ExternalAgentRegistry;

  constructor(private readonly cwd: string, config = loadConfig(cwd)) {
    this.config = config;
    this.registry = externalAgentRegistryFromConfig(config);
  }

  listTools(): McpToolDefinition[] {
    return mcpTools;
  }

  listAgents(): ExternalAgentProfile[] {
    return this.registry.list();
  }

  async startWorkflow(input: StartWorkflowInput): Promise<{ sessionId: string; state: AgentGraphState }> {
    const router = new ModelRouter(this.config);
    const access = buildAccessPolicy(this.config, { mode: input.accessMode });
    const ledger = new EventLedger(makeId("session"), access.mode);
    const state: AgentGraphState = {
      sessionId: ledger.sessionId,
      goal: input.goal,
      routing: router.getPlan(),
      access,
      events: ledger.events,
      eventArtifacts: ledger.artifacts,
      agents: [],
      candidates: [],
      repairCandidates: [],
      debateRounds: [],
      modelNotes: [],
      usageSummary: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      changedFiles: [],
      runResults: [],
      approvals: {
        patchApproved: access.patchApproved,
        shellApproved: access.shellApproved,
        repairApproved: access.repairApproved
      }
    };

    ledger.append({
      type: "access_mode",
      phase: "routing",
      accessMode: access.mode,
      cloudAllowed: access.cloudAllowed,
      patchApproved: access.patchApproved,
      shellApproved: access.shellApproved,
      repairApproved: access.repairApproved,
      description: access.mode === "full" ? "MODE: FULL AUTONOMY - every step is visible and logged." : access.mode === "restricted" ? "MODE: RESTRICTED - offline/read-only." : "MODE: PARTIAL SUPERVISION - patch/shell/repair require approval."
    });
    ledger.append({
      type: "evidence_update",
      phase: "routing",
      evidence: [`mcp bridge workflow started`, `routing mode=${state.routing.mode}`, `assignments=${state.routing.assignments.length}`]
    });

    for (const profile of this.registry.list()) {
      appendExternalRegistered(ledger, profile);
    }
    for (const assignment of state.routing.assignments) {
      const externalAgentId = externalAgentIdFromProvider(assignment.provider);
      if (!externalAgentId) continue;
      state.agents.push({
        id: `${assignment.role}:${externalAgentId}`,
        role: assignment.role,
        provider: assignment.provider,
        model: assignment.model,
        status: "pending",
        agentKind: "external",
        summary: assignment.reason
      });
    }

    await saveBridgeSession(this.cwd, state);
    return { sessionId: state.sessionId, state };
  }

  async getWorkflowState(input: WorkflowRef = {}): Promise<SessionRecord> {
    return input.sessionId ? loadSession(this.cwd, input.sessionId) : loadLatestSession(this.cwd);
  }

  async registerExternalAgent(input: ExternalAgentRegistrationInput & WorkflowRef): Promise<{ profile: ExternalAgentProfile; sessionId?: string }> {
    const profile = this.registry.register(input);
    if (input.sessionId) {
      await this.withSession(input.sessionId, (state, ledger) => {
        appendExternalRegistered(ledger, profile);
        upsertExternalAgentState(state, profile.allowedRoles[0] ?? "core", profile, "pending", "External MCP agent registered.");
      });
    }
    return { profile, sessionId: input.sessionId };
  }

  async submitAgentResult(input: WorkflowRef & { externalAgentId: string; role: AgentRole; summary: string; result?: unknown; usage?: CostUsageInput }): Promise<{ sessionId: string }> {
    return this.withSession(requiredSession(input), (state, ledger) => {
      const profile = this.requireProfile(input.externalAgentId);
      const resultRef = input.result === undefined ? undefined : ledger.writeArtifact("external_results", JSON.stringify(input.result, null, 2), "json");
      upsertExternalAgentState(state, input.role, profile, "success", input.summary);
      appendExternalCall(ledger, input.role, profile, "tomorrowedge.submit_agent_result", "success", undefined, resultRef);
      ledger.append({ type: "external_agent_result", phase: phaseForRole(input.role), role: input.role, provider: `external:${profile.id}`, model: profile.name, externalAgentId: profile.id, resultRef, summary: input.summary });
      appendExternalCost(ledger, input.role, profile, input.usage);
    });
  }

  async invokeExternalAgent(input: WorkflowRef & { externalAgentId: string; role: AgentRole; toolName?: string; prompt?: string; arguments?: Record<string, unknown> }): Promise<{ sessionId: string; result: unknown; attempts: number }> {
    const sessionId = await this.resolveSessionId(requiredSession(input));
    let payload: { sessionId: string; result: unknown; attempts: number } | undefined;
    await this.withSession(sessionId, async (state, ledger) => {
      const profile = this.requireProfile(input.externalAgentId);
      const context = await this.getContext({ sessionId });
      if (profile.command && !profile.autoStart) {
        const result = await runCommandExternalAgent({
          cwd: this.cwd,
          profile,
          role: input.role,
          task: input.prompt ?? `Act as ${input.role} for TomorrowEdge workflow ${sessionId}.`,
          context: { ...context, arguments: input.arguments ?? {} },
          ledger
        });
        upsertExternalAgentState(state, input.role, profile, result.ok ? "success" : "failed", result.summary);
        payload = { sessionId, result, attempts: 1 };
        if (!result.ok) throw new Error(result.error ?? "External command runner failed.");
        return;
      }
      const requestRef = ledger.writeArtifact("external_requests", JSON.stringify({ role: input.role, prompt: input.prompt, context, arguments: input.arguments }, null, 2), "json");
      appendExternalCall(ledger, input.role, profile, "tomorrowedge.invoke_external_agent", "start", requestRef);
      upsertExternalAgentState(state, input.role, profile, "running", "External MCP process call started.");
      const client = new ExternalAgentProcessClient(profile, this.cwd);
      try {
        await client.start();
        const tools = await client.listTools();
        const toolName = input.toolName ?? chooseExternalTool(tools.map((tool) => tool.name));
        const result = await client.callTool(toolName, {
          ...(input.arguments ?? {}),
          prompt: input.prompt ?? `Act as ${input.role} for TomorrowEdge workflow ${sessionId}.`,
          context
        });
        if (!result.ok) {
          throw new Error(result.error ?? "External MCP tool call failed.");
        }
        const responseRef = ledger.writeArtifact("external_results", JSON.stringify(result.result, null, 2), "json");
        appendExternalCall(ledger, input.role, profile, toolName, "success", requestRef, responseRef);
        ledger.append({ type: "external_agent_result", phase: phaseForRole(input.role), role: input.role, provider: `external:${profile.id}`, model: profile.name, externalAgentId: profile.id, resultRef: responseRef, summary: `External MCP process returned ${toolName}.` });
        upsertExternalAgentState(state, input.role, profile, "success", `External MCP process returned ${toolName}.`);
        payload = { sessionId, result: result.result, attempts: result.attempts };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendExternalCall(ledger, input.role, profile, "tomorrowedge.invoke_external_agent", "failure", requestRef, undefined, message);
        ledger.append({ type: "external_agent_error", phase: phaseForRole(input.role), role: input.role, provider: `external:${profile.id}`, model: profile.name, externalAgentId: profile.id, error: message });
        upsertExternalAgentState(state, input.role, profile, "failed", message);
        throw error;
      } finally {
        await client.stop();
      }
    });
    return payload!;
  }

  async recordEvent(input: WorkflowRef & { event: Record<string, unknown> }): Promise<{ sessionId: string; event: TomorrowEdgeEvent }> {
    const sessionId = requiredSession(input);
    let recorded!: TomorrowEdgeEvent;
    await this.withSession(sessionId, (_state, ledger) => {
      recorded = ledger.append({
        type: "external_agent_result",
        phase: "summary",
        externalAgentId: String(input.event.externalAgentId ?? "external"),
        summary: String(input.event.summary ?? input.event.type ?? "external event recorded"),
        ...input.event
      } as never);
    });
    return { sessionId, event: recorded };
  }

  async getContext(input: WorkflowRef = {}): Promise<Record<string, unknown>> {
    const session = await this.getWorkflowState(input);
    const state = session.state;
    return {
      sessionId: state.sessionId,
      goal: state.goal,
      routing: state.routing,
      plan: state.plan,
      contextSelection: state.contextSelection,
      candidates: state.candidates.map((candidate) => ({ candidateId: candidate.candidateId, summary: candidate.summary, filesChanged: candidate.filesChanged, estimatedRisk: candidate.estimatedRisk })),
      review: state.review,
      judge: state.judge
    };
  }

  async proposePatch(input: WorkflowRef & { externalAgentId: string; role?: AgentRole; candidate: Partial<PatchCandidate> }): Promise<{ sessionId: string; candidate: PatchCandidate }> {
    const sessionId = requiredSession(input);
    const role = input.role ?? "coder_a";
    let candidate!: PatchCandidate;
    await this.withSession(sessionId, (state, ledger) => {
      const profile = this.requireProfile(input.externalAgentId);
      candidate = normalizePatchCandidate(input.candidate, profile.id);
      state.candidates.push(candidate);
      upsertExternalAgentState(state, role, profile, "success", `Proposed patch candidate ${candidate.candidateId}.`);
      const diffRef = candidate.unifiedDiff ? ledger.writeArtifact("diffs", candidate.unifiedDiff) : undefined;
      appendExternalCall(ledger, role, profile, "tomorrowedge.propose_patch", "success", undefined, diffRef);
      ledger.append({ type: "external_agent_patch_candidate", phase: "coding", role, provider: `external:${profile.id}`, model: profile.name, externalAgentId: profile.id, candidateId: candidate.candidateId, filesChanged: candidate.filesChanged, diffRef, summary: candidate.summary, estimatedRisk: candidate.estimatedRisk });
      ledger.append({ type: "patch_candidate", phase: "coding", role, provider: `external:${profile.id}`, model: profile.name, candidateId: candidate.candidateId, approach: candidate.approach, summary: candidate.summary, filesChanged: candidate.filesChanged, diffRef, estimatedRisk: candidate.estimatedRisk });
    });
    return { sessionId, candidate };
  }

  async submitReview(input: WorkflowRef & { externalAgentId: string; role?: AgentRole; review: Partial<ReviewReport> }): Promise<{ sessionId: string; review: ReviewReport }> {
    const sessionId = requiredSession(input);
    const role = input.role ?? "reviewer";
    let review!: ReviewReport;
    await this.withSession(sessionId, (state, ledger) => {
      const profile = this.requireProfile(input.externalAgentId);
      review = normalizeReview(input.review);
      state.review = review;
      upsertExternalAgentState(state, role, profile, "success", review.overallRecommendation);
      const reviewRef = ledger.writeArtifact("reviews", JSON.stringify(review, null, 2), "json");
      appendExternalCall(ledger, role, profile, "tomorrowedge.submit_review", "success", undefined, reviewRef);
      ledger.append({ type: "external_agent_review", phase: "review", role, provider: `external:${profile.id}`, model: profile.name, externalAgentId: profile.id, reviewRef, recommendation: review.overallRecommendation });
      ledger.append({ type: "review_decision", phase: "review", role, provider: `external:${profile.id}`, model: profile.name, reviewRef, recommendation: review.overallRecommendation });
    });
    return { sessionId, review };
  }

  async submitJudgment(input: WorkflowRef & { externalAgentId: string; role?: AgentRole; judgment: Partial<JudgeDecision> }): Promise<{ sessionId: string; judgment: JudgeDecision }> {
    const sessionId = requiredSession(input);
    const role = input.role ?? "judge";
    let judgment!: JudgeDecision;
    await this.withSession(sessionId, (state, ledger) => {
      const profile = this.requireProfile(input.externalAgentId);
      judgment = normalizeJudgment(input.judgment);
      state.judge = judgment;
      upsertExternalAgentState(state, role, profile, "success", judgment.reason);
      const decisionRef = ledger.writeArtifact("judge_decisions", JSON.stringify(judgment, null, 2), "json");
      appendExternalCall(ledger, role, profile, "tomorrowedge.submit_judgment", "success", undefined, decisionRef);
      ledger.append({ type: "external_agent_judgment", phase: "judge", role, provider: `external:${profile.id}`, model: profile.name, externalAgentId: profile.id, decision: judgment.decision, selectedCandidateId: judgment.selectedCandidateId, reason: judgment.reason, decisionRef });
      ledger.append({ type: "judge_decision", phase: "judge", role, provider: `external:${profile.id}`, model: profile.name, decision: judgment.decision, selectedCandidateId: judgment.selectedCandidateId, reason: judgment.reason, confidence: judgment.confidence, decisionRef });
    });
    return { sessionId, judgment };
  }

  async getTrace(input: WorkflowRef = {}): Promise<{ sessionId: string; events: TomorrowEdgeEvent[]; markdown: string }> {
    const session = await this.getWorkflowState(input);
    return { sessionId: session.sessionId, events: session.state.events, markdown: renderEventMarkdown(session.state.events) };
  }

  async exportSession(input: WorkflowRef & { format?: "json" | "markdown" } = {}): Promise<{ sessionId: string; format: "json" | "markdown"; content: string }> {
    const session = await this.getWorkflowState(input);
    const format = input.format ?? "markdown";
    return {
      sessionId: session.sessionId,
      format,
      content: format === "json" ? JSON.stringify(session, null, 2) : renderEventMarkdown(session.state.events)
    };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "tomorrowedge.start_workflow":
        return this.startWorkflow(args as StartWorkflowInput);
      case "tomorrowedge.get_workflow_state":
        return this.getWorkflowState(args as WorkflowRef);
      case "tomorrowedge.register_external_agent":
        return this.registerExternalAgent(args as ExternalAgentRegistrationInput & WorkflowRef);
      case "tomorrowedge.submit_agent_result":
        return this.submitAgentResult(args as WorkflowRef & { externalAgentId: string; role: AgentRole; summary: string; result?: unknown; usage?: CostUsageInput });
      case "tomorrowedge.invoke_external_agent":
        return this.invokeExternalAgent(args as WorkflowRef & { externalAgentId: string; role: AgentRole; toolName?: string; prompt?: string; arguments?: Record<string, unknown> });
      case "tomorrowedge.record_event":
        return this.recordEvent(args as WorkflowRef & { event: Record<string, unknown> });
      case "tomorrowedge.get_context":
        return this.getContext(args as WorkflowRef);
      case "tomorrowedge.propose_patch":
        return this.proposePatch(args as WorkflowRef & { externalAgentId: string; role?: AgentRole; candidate: Partial<PatchCandidate> });
      case "tomorrowedge.submit_review":
        return this.submitReview(args as WorkflowRef & { externalAgentId: string; role?: AgentRole; review: Partial<ReviewReport> });
      case "tomorrowedge.submit_judgment":
        return this.submitJudgment(args as WorkflowRef & { externalAgentId: string; role?: AgentRole; judgment: Partial<JudgeDecision> });
      case "tomorrowedge.get_trace":
        return this.getTrace(args as WorkflowRef);
      case "tomorrowedge.export_session":
        return this.exportSession(args as WorkflowRef & { format?: "json" | "markdown" });
      default:
        throw new Error(`Unknown TomorrowEdge MCP tool: ${name}`);
    }
  }

  async probeAgents(): Promise<Array<{ id: string; name: string; command?: string; ok: boolean; detail: string; tools?: string[] }>> {
    const rows = [];
    for (const profile of this.registry.list()) {
      const probe = await probeExternalAgent(profile, this.cwd);
      rows.push({ id: profile.id, name: profile.name, command: profile.command, ok: probe.ok, detail: probe.detail, tools: probe.tools?.map((tool) => tool.name) });
    }
    return rows;
  }

  private requireProfile(id: string): ExternalAgentProfile {
    const profile = this.registry.get(id);
    if (!profile) throw new Error(`External agent is not registered or enabled: ${id}`);
    return profile;
  }

  private async withSession(sessionId: string, mutate: (state: AgentGraphState, ledger: EventLedger) => void | Promise<void>): Promise<{ sessionId: string }> {
    const actualSessionId = await this.resolveSessionId(sessionId);
    const session = await loadSession(this.cwd, actualSessionId);
    const state = session.state;
    const ledger = ledgerFromState(state);
    try {
      await mutate(state, ledger);
    } finally {
      state.events = ledger.events;
      state.eventArtifacts = [...(state.eventArtifacts ?? []), ...ledger.artifacts];
      await saveBridgeSession(this.cwd, state);
    }
    return { sessionId: actualSessionId };
  }

  private async resolveSessionId(sessionId: string): Promise<string> {
    return sessionId === "latest" ? (await loadLatestSession(this.cwd)).sessionId : sessionId;
  }
}

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const stringArraySchema = { type: "array", items: { type: "string" } };
const agentRoleJsonSchema = { type: "string", enum: [...agentRoles] };
const trustLevelJsonSchema = { type: "string", enum: ["low", "medium", "high", "owner"] };
const costUsageJsonSchema = objectSchema({
  inputTokens: { type: "number", minimum: 0 },
  outputTokens: { type: "number", minimum: 0 },
  totalTokens: { type: "number", minimum: 0 },
  estimatedCostUsd: { type: "number", minimum: 0 }
});
const patchCandidateInputJsonSchema = objectSchema({
  candidateId: { type: "string" },
  agentId: { type: "string" },
  approach: { type: "string", enum: ["minimal_patch", "refactor", "test_first", "alternative", "repair"] },
  summary: { type: "string" },
  filesChanged: stringArraySchema,
  unifiedDiff: { type: "string" },
  testPlan: stringArraySchema,
  knownTradeoffs: stringArraySchema,
  estimatedRisk: { type: "string", enum: ["low", "medium", "high"] }
});
const redTeamFindingJsonSchema = objectSchema({
  id: { type: "string" },
  severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
  title: { type: "string" },
  detail: { type: "string" },
  requiresHumanAttention: { type: "boolean" }
});
const candidateReviewJsonSchema = objectSchema({
  candidateId: { type: "string" },
  correctnessScore: { type: "number" },
  riskScore: { type: "number" },
  invasiveness: { type: "string", enum: ["low", "medium", "high"] },
  testCoverage: { type: "string", enum: ["none", "weak", "adequate", "strong"] },
  securityConcerns: stringArraySchema,
  regressionConcerns: stringArraySchema,
  redTeamFindings: { type: "array", items: redTeamFindingJsonSchema },
  recommendation: { type: "string", enum: ["accept", "accept_with_minor_change", "revise", "reject"] },
  notes: stringArraySchema
});
const reviewReportInputJsonSchema = objectSchema({
  mode: { type: "string", enum: ["standard", "red_team"] },
  reviews: { type: "array", items: candidateReviewJsonSchema },
  overallRecommendation: { type: "string" }
});
const judgmentInputJsonSchema = objectSchema({
  selectedCandidateId: { type: "string" },
  decision: { type: "string", enum: ["select", "request_revision", "ask_user", "abort"] },
  reason: { type: "string" },
  borrowIdeasFromOtherCandidates: stringArraySchema,
  confidence: { type: "number", minimum: 0, maximum: 1 },
  requiredUserDecision: { type: "string" }
});

export const mcpTools: McpToolDefinition[] = [
  tool("tomorrowedge.start_workflow", "Start a visible TomorrowEdge workflow session.", { goal: { type: "string" }, accessMode: { type: "string", enum: ["restricted", "partial", "full"] } }, ["goal"]),
  tool("tomorrowedge.get_workflow_state", "Read the current workflow state.", { sessionId: { type: "string" } }),
  tool("tomorrowedge.register_external_agent", "Register a Claude Code, Codex, or other MCP external coding agent.", { id: { type: "string" }, name: { type: "string" }, sessionId: { type: "string" }, capabilities: stringArraySchema, allowedRoles: { type: "array", items: agentRoleJsonSchema }, trustLevel: trustLevelJsonSchema }, ["id"]),
  tool("tomorrowedge.submit_agent_result", "Submit a traced external agent result.", { sessionId: { type: "string" }, externalAgentId: { type: "string" }, role: agentRoleJsonSchema, summary: { type: "string" }, result: {}, usage: costUsageJsonSchema }, ["sessionId", "externalAgentId", "role", "summary"]),
  tool("tomorrowedge.invoke_external_agent", "Invoke a configured external MCP agent process and record the result.", { sessionId: { type: "string" }, externalAgentId: { type: "string" }, role: agentRoleJsonSchema, toolName: { type: "string" }, prompt: { type: "string" }, arguments: { type: "object" } }, ["sessionId", "externalAgentId", "role"]),
  tool("tomorrowedge.record_event", "Record a structured external agent event in the ledger.", { sessionId: { type: "string" }, event: { type: "object", additionalProperties: true } }, ["sessionId", "event"]),
  tool("tomorrowedge.get_context", "Get workflow context for an external role-bound agent.", { sessionId: { type: "string" } }),
  tool("tomorrowedge.propose_patch", "Submit an external patch candidate.", { sessionId: { type: "string" }, externalAgentId: { type: "string" }, role: agentRoleJsonSchema, candidate: patchCandidateInputJsonSchema }, ["sessionId", "externalAgentId", "candidate"]),
  tool("tomorrowedge.submit_review", "Submit an external review report.", { sessionId: { type: "string" }, externalAgentId: { type: "string" }, role: agentRoleJsonSchema, review: reviewReportInputJsonSchema }, ["sessionId", "externalAgentId", "review"]),
  tool("tomorrowedge.submit_judgment", "Submit an external judge decision.", { sessionId: { type: "string" }, externalAgentId: { type: "string" }, role: agentRoleJsonSchema, judgment: judgmentInputJsonSchema }, ["sessionId", "externalAgentId", "judgment"]),
  tool("tomorrowedge.get_trace", "Return the workflow event ledger.", { sessionId: { type: "string" } }),
  tool("tomorrowedge.export_session", "Export a workflow session as JSON or markdown.", { sessionId: { type: "string" }, format: { type: "string", enum: ["json", "markdown"] } })
];

type CostUsageInput = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
};

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): McpToolDefinition {
  return {
    name,
    description,
    inputSchema: objectSchema(properties, required)
  };
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function ledgerFromState(state: AgentGraphState): EventLedger {
  const ledger = new EventLedger(state.sessionId, state.access.mode);
  ledger.events.push(...(state.events ?? []));
  return ledger;
}

async function saveBridgeSession(cwd: string, state: AgentGraphState): Promise<void> {
  const sessionDir = path.join(cwd, ".tomorrowedge", "sessions", state.sessionId);
  await mkdir(sessionDir, { recursive: true });
  const artifacts = state.eventArtifacts ?? [];
  const record: SessionRecord = {
    sessionId: state.sessionId,
    createdAt: new Date().toISOString(),
    eventCount: state.events.length,
    artifactCount: artifacts.length,
    state: {
      ...state,
      eventArtifacts: artifacts.map((artifact) => ({ ref: artifact.ref, content: "[stored in artifact file]" }))
    }
  };
  await writeFile(path.join(sessionDir, "session.json"), JSON.stringify(record, null, 2), "utf8");
  await writeFile(path.join(sessionDir, "events.jsonl"), state.events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  for (const artifact of artifacts) {
    if (artifact.content === "[stored in artifact file]") continue;
    const artifactPath = path.join(sessionDir, artifact.ref);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, artifact.content, "utf8");
  }
}

function appendExternalRegistered(ledger: EventLedger, profile: ExternalAgentProfile): void {
  ledger.append({
    type: "external_agent_registered",
    phase: "routing",
    provider: `external:${profile.id}`,
    model: profile.name,
    externalAgentId: profile.id,
    name: profile.name,
    transport: profile.transport,
    capabilities: profile.capabilities,
    allowedRoles: profile.allowedRoles,
    trustLevel: profile.trustLevel
  });
}

function appendExternalCost(ledger: EventLedger, role: AgentRole, profile: ExternalAgentProfile, usage?: CostUsageInput): void {
  if (!usage) return;
  ledger.append({
    type: "external_agent_cost_usage",
    phase: phaseForRole(role),
    role,
    provider: `external:${profile.id}`,
    model: profile.name,
    externalAgentId: profile.id,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)),
    estimatedCostUsd: usage.estimatedCostUsd
  });
}

function appendExternalCall(ledger: EventLedger, role: AgentRole, profile: ExternalAgentProfile, toolName: string, status: "start" | "success" | "failure", requestRef?: string, responseRef?: string, error?: string): void {
  ledger.append({
    type: "external_agent_call",
    phase: phaseForRole(role),
    role,
    provider: `external:${profile.id}`,
    model: profile.name,
    externalAgentId: profile.id,
    tool: toolName,
    status,
    requestRef,
    responseRef,
    error
  });
}

function upsertExternalAgentState(state: AgentGraphState, role: AgentRole, profile: ExternalAgentProfile, status: AgentRunState["status"], summary: string): void {
  const id = `${role}:${profile.id}`;
  const existing = state.agents.find((agent) => agent.id === id);
  const next: AgentRunState = {
    id,
    role,
    provider: `external:${profile.id}`,
    model: profile.name,
    status,
    agentKind: "external",
    startedAt: existing?.startedAt ?? new Date().toISOString(),
    endedAt: status === "success" || status === "failed" ? new Date().toISOString() : existing?.endedAt,
    summary
  };
  if (existing) Object.assign(existing, next);
  else state.agents.push(next);
}

function normalizePatchCandidate(input: Partial<PatchCandidate>, externalAgentId: string): PatchCandidate {
  return {
    candidateId: input.candidateId ?? makeId(`external_${externalAgentId}_candidate`),
    agentId: input.agentId ?? externalAgentId,
    approach: input.approach ?? "minimal_patch",
    summary: input.summary ?? "External agent patch candidate.",
    filesChanged: input.filesChanged ?? [],
    unifiedDiff: input.unifiedDiff ?? "",
    testPlan: input.testPlan ?? [],
    knownTradeoffs: input.knownTradeoffs ?? [],
    estimatedRisk: input.estimatedRisk ?? "medium"
  };
}

function normalizeReview(input: Partial<ReviewReport>): ReviewReport {
  return {
    mode: input.mode ?? "standard",
    reviews: input.reviews ?? [],
    overallRecommendation: input.overallRecommendation ?? "External review submitted."
  };
}

function normalizeJudgment(input: Partial<JudgeDecision>): JudgeDecision {
  return {
    decision: input.decision ?? "ask_user",
    selectedCandidateId: input.selectedCandidateId,
    reason: input.reason ?? "External judgment submitted.",
    borrowIdeasFromOtherCandidates: input.borrowIdeasFromOtherCandidates,
    confidence: input.confidence ?? 0.5,
    requiredUserDecision: input.requiredUserDecision
  };
}

function chooseExternalTool(toolNames: string[]): string {
  if (!toolNames.length) {
    throw new Error("External MCP agent returned no tools. Register the agent with an explicit toolName or check the agent command.");
  }
  const matched = toolNames.find((name) => /agent|chat|complete|prompt|run/i.test(name));
  if (matched) return matched;
  throw new Error(
    `Could not auto-select a tool from external MCP agent. Available tools: ${toolNames.join(", ")}. ` +
    `Specify an explicit toolName when calling invoke_external_agent.`
  );
}

function requiredSession(input: WorkflowRef): string {
  if (!input.sessionId) throw new Error("sessionId is required for this MCP tool.");
  return input.sessionId;
}

function phaseForRole(role: AgentRole) {
  if (role === "vision") return "vision";
  if (role === "core" || role === "planner") return "planning";
  if (role === "explorer") return "exploration";
  if (role === "reviewer") return "review";
  if (role === "judge") return "judge";
  if (role === "repairer") return "repair";
  if (role === "summarizer") return "summary";
  if (role === "runner") return "shell";
  return "coding";
}

export async function readArtifact(cwd: string, sessionId: string, ref: string): Promise<string> {
  return readFile(path.join(cwd, ".tomorrowedge", "sessions", sessionId, ref), "utf8");
}
