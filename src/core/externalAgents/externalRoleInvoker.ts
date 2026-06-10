import type { AgentRole } from "../../schemas/agentTask.js";
import type { EventLedger } from "../events/eventLedger.js";
import type { ExternalAgentProfile } from "./externalAgentTypes.js";
import { ExternalAgentProcessClient, type ExternalAgentTool } from "./externalAgentProcess.js";
import { runCommandExternalAgent } from "./runners/commandExternalAgentRunner.js";
import type { ExternalOutputContract, ExternalTaskEnvelope } from "./contracts/externalTaskEnvelope.js";
import { normalizeExternalAgentResponse } from "./adapters/registry.js";

export type ExternalRoleInvocation = {
  externalAgentId: string;
  role: AgentRole;
  payload: unknown;
  summary: string;
  attempts: number;
};

type PooledExternalClient = {
  client: ExternalAgentProcessClient;
  started: Promise<void>;
};

const processClientPool = new Map<string, PooledExternalClient>();

export async function invokeExternalRole(input: {
  cwd: string;
  profile: ExternalAgentProfile;
  role: AgentRole;
  prompt: string;
  context?: unknown;
  ledger: EventLedger;
  toolName?: string;
  outputContract?: ExternalOutputContract;
}): Promise<ExternalRoleInvocation> {
  const envelope = buildTaskEnvelope(input);
  if (!input.profile.command) {
    return runConfiguredExternalProfile(input, envelope);
  }
  if (input.profile.command && !input.profile.autoStart) {
    const result = await runCommandExternalAgent({
      cwd: input.cwd,
      profile: input.profile,
      role: input.role,
      task: input.prompt,
      context: envelope,
      ledger: input.ledger
    });
    if (!result.ok) throw new Error(result.error ?? "External command runner failed.");
    const rawPayload = parseJsonish(result.stdout) ?? { summary: result.summary, stdout: result.stdout };
    const normalized = normalizeExternalPayload(input, envelope, rawPayload);
    return {
      externalAgentId: input.profile.id,
      role: input.role,
      payload: normalized.payload,
      summary: normalized.summary,
      attempts: 1
    };
  }

  const requestRef = input.ledger.writeArtifact("external_requests", JSON.stringify({
    role: input.role,
    prompt: input.prompt,
    context: envelope
  }, null, 2), "json");
  input.ledger.append({
    type: "external_agent_call",
    phase: phaseForRole(input.role),
    role: input.role,
    provider: `external:${input.profile.id}`,
    model: input.profile.name,
    externalAgentId: input.profile.id,
    tool: "tomorrowedge.native_external_role",
    status: "start",
    requestRef
  });

  const pooled = await getPooledExternalClient(input.profile, input.cwd);
  const client = pooled.client;
  try {
    const tools = await client.listTools();
    const toolName = input.toolName ?? chooseExternalTool(tools);
    const result = await client.callTool(toolName, {
      role: input.role,
      prompt: input.prompt,
      context: envelope,
      outputContract: envelope.outputContract
    });
    if (!result.ok) throw new Error(result.error ?? "External MCP tool call failed.");
    const rawPayload = unwrapMcpToolResult(result.result);
    const normalized = normalizeExternalPayload(input, envelope, rawPayload);
    const responseRef = input.ledger.writeArtifact("external_results", JSON.stringify(result.result, null, 2), "json");
    input.ledger.append({
      type: "external_agent_call",
      phase: phaseForRole(input.role),
      role: input.role,
      provider: `external:${input.profile.id}`,
      model: input.profile.name,
      externalAgentId: input.profile.id,
      tool: toolName,
      status: "success",
      requestRef,
      responseRef
    });
    input.ledger.append({
      type: "external_agent_result",
      phase: phaseForRole(input.role),
      role: input.role,
      provider: `external:${input.profile.id}`,
      model: input.profile.name,
      externalAgentId: input.profile.id,
      resultRef: responseRef,
      summary: normalized.summary || summarizePayload(normalized.payload, `External MCP process returned ${toolName}.`)
    });
    return {
      externalAgentId: input.profile.id,
      role: input.role,
      payload: normalized.payload,
      summary: normalized.summary || summarizePayload(normalized.payload, `External MCP process returned ${toolName}.`),
      attempts: result.attempts
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await discardPooledExternalClient(pooled.key);
    input.ledger.append({
      type: "external_agent_call",
      phase: phaseForRole(input.role),
      role: input.role,
      provider: `external:${input.profile.id}`,
      model: input.profile.name,
      externalAgentId: input.profile.id,
      tool: "tomorrowedge.native_external_role",
      status: "failure",
      requestRef,
      error: message
    });
    input.ledger.append({
      type: "external_agent_error",
      phase: phaseForRole(input.role),
      role: input.role,
      provider: `external:${input.profile.id}`,
      model: input.profile.name,
      externalAgentId: input.profile.id,
      error: message
    });
    throw error;
  } finally {
    if (input.profile.command && input.profile.autoStart === false) await discardPooledExternalClient(pooled.key);
  }
}

function runConfiguredExternalProfile(input: {
  cwd: string;
  profile: ExternalAgentProfile;
  role: AgentRole;
  prompt: string;
  context?: unknown;
  ledger: EventLedger;
  toolName?: string;
  outputContract?: ExternalOutputContract;
}, envelope: ExternalTaskEnvelope): ExternalRoleInvocation {
  const requestRef = input.ledger.writeArtifact("external_requests", JSON.stringify({
    role: input.role,
    prompt: input.prompt,
    context: envelope
  }, null, 2), "json");
  input.ledger.append({
    type: "external_agent_call",
    phase: phaseForRole(input.role),
    role: input.role,
    provider: `external:${input.profile.id}`,
    model: input.profile.name,
    externalAgentId: input.profile.id,
    tool: "tomorrowedge.configured_profile",
    status: "start",
    requestRef
  });
  const rawPayload = configuredProfilePayload(input.profile, input.role, envelope);
  const normalized = normalizeExternalPayload(input, envelope, rawPayload);
  const responseRef = input.ledger.writeArtifact("external_results", JSON.stringify(normalized.payload, null, 2), "json");
  const summary = normalized.summary || summarizePayload(normalized.payload, `Configured external agent profile ${input.profile.id} produced a typed mock result.`);
  input.ledger.append({
    type: "external_agent_call",
    phase: phaseForRole(input.role),
    role: input.role,
    provider: `external:${input.profile.id}`,
    model: input.profile.name,
    externalAgentId: input.profile.id,
    tool: "tomorrowedge.configured_profile",
    status: "success",
    requestRef,
    responseRef
  });
  input.ledger.append({
    type: "external_agent_result",
    phase: phaseForRole(input.role),
    role: input.role,
    provider: `external:${input.profile.id}`,
    model: input.profile.name,
    externalAgentId: input.profile.id,
    resultRef: responseRef,
    summary
  });
  return {
    externalAgentId: input.profile.id,
    role: input.role,
    payload: normalized.payload,
    summary,
    attempts: 1
  };
}

function normalizeExternalPayload(input: {
  profile: ExternalAgentProfile;
  role: AgentRole;
  ledger: EventLedger;
}, envelope: ExternalTaskEnvelope, rawPayload: unknown): ReturnType<typeof normalizeExternalAgentResponse> {
  const normalized = normalizeExternalAgentResponse({
    profile: input.profile,
    role: input.role,
    outputContract: envelope.outputContract,
    rawPayload
  });
  input.ledger.append({
    type: "external_agent_normalization",
    phase: phaseForRole(input.role),
    role: input.role,
    provider: `external:${input.profile.id}`,
    model: input.profile.name,
    externalAgentId: input.profile.id,
    adapter: normalized.adapter,
    responseMode: normalized.responseMode,
    status: normalized.status,
    warnings: normalized.warnings,
    summary: normalized.summary
  });
  return normalized;
}

export async function releaseExternalAgentProcessPool(): Promise<void> {
  const clients = [...processClientPool.values()].map((entry) => entry.client);
  processClientPool.clear();
  await Promise.all(clients.map((client) => client.stop().catch(() => undefined)));
}

export function externalAgentProcessPoolSize(): number {
  return processClientPool.size;
}

async function getPooledExternalClient(profile: ExternalAgentProfile, cwd: string): Promise<{ key: string; client: ExternalAgentProcessClient }> {
  const key = processPoolKey(profile, cwd);
  let entry = processClientPool.get(key);
  if (!entry) {
    const client = new ExternalAgentProcessClient(profile, cwd);
    entry = { client, started: client.start() };
    processClientPool.set(key, entry);
  }
  try {
    await entry.started;
    return { key, client: entry.client };
  } catch (error) {
    processClientPool.delete(key);
    await entry.client.stop().catch(() => undefined);
    throw error;
  }
}

async function discardPooledExternalClient(key: string): Promise<void> {
  const entry = processClientPool.get(key);
  if (!entry) return;
  processClientPool.delete(key);
  await entry.client.stop().catch(() => undefined);
}

function processPoolKey(profile: ExternalAgentProfile, cwd: string): string {
  return JSON.stringify({
    id: profile.id,
    command: profile.command,
    args: profile.args ?? [],
    cwd: profile.cwd ?? cwd,
    env: profile.env ?? {}
  });
}

function buildTaskEnvelope(input: { ledger: EventLedger; role: AgentRole; prompt: string; context?: unknown; outputContract?: ExternalOutputContract }): ExternalTaskEnvelope {
  return {
    sessionId: input.ledger.sessionId,
    role: input.role,
    goal: extractGoal(input.context) ?? input.prompt,
    instructions: input.prompt,
    context: (asRecord(input.context) ?? {}) as ExternalTaskEnvelope["context"],
    outputContract: input.outputContract ?? outputContractForRole(input.role)
  };
}

function outputContractForRole(role: AgentRole): ExternalOutputContract {
  if (role === "core" || role === "planner") return "plan";
  if (role === "coder_a" || role === "coder_b" || role === "repairer") return "patch";
  if (role === "reviewer") return "review";
  if (role === "judge") return "judgment";
  return "freeform";
}

function extractGoal(context: unknown): string | undefined {
  const object = asRecord(context);
  return typeof object?.goal === "string" ? object.goal : undefined;
}

export function unwrapExternalPayload(value: unknown): unknown {
  return unwrapMcpToolResult(value);
}

function chooseExternalTool(tools: ExternalAgentTool[]): string {
  const preferred = tools.find((tool) => /(^|[._-])(agent|chat|complete|prompt|run)([._-]|$)/i.test(tool.name));
  return (preferred ?? tools[0])?.name ?? "agent.run";
}

function unwrapMcpToolResult(value: unknown): unknown {
  const object = asRecord(value);
  if (object?.structuredContent !== undefined) return object.structuredContent;
  if (object?.result !== undefined) return unwrapMcpToolResult(object.result);
  const text = textContent(value);
  return parseJsonish(text) ?? value;
}

function textContent(value: unknown): string | undefined {
  const object = asRecord(value);
  const content = object?.content;
  if (!Array.isArray(content)) return undefined;
  return content
    .map((item) => {
      const entry = asRecord(item);
      return typeof entry?.text === "string" ? entry.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseJsonish(value: unknown): unknown | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    console.error(`[externalRole] Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function summarizePayload(payload: unknown, fallback: string): string {
  const object = asRecord(payload);
  const summary = object?.summary;
  if (typeof summary === "string" && summary.trim()) return summary.slice(0, 500);
  return fallback;
}

function configuredProfilePayload(profile: ExternalAgentProfile, role: AgentRole, envelope: ExternalTaskEnvelope): unknown {
  const baseSummary = `${profile.name} is configured as an external ${role} agent, but no command/MCP process is attached yet.`;
  if (role === "core" || role === "planner") {
    return {
      summary: baseSummary,
      plan: {
        goal: envelope.goal,
        taskType: "unknown",
        riskLevel: profile.trustLevel === "high" || profile.trustLevel === "owner" ? "medium" : "low",
        constraints: [
          "Configured external profile did not execute a real process.",
          "Use this as a traceable role placeholder until command/autoStart is configured."
        ],
        steps: [
          { id: "external-context", title: "Read external task envelope", detail: "Inspect role-bound context and output contract." },
          { id: "external-evidence", title: "Request typed evidence", detail: "Require patch, review, judge, and artifact refs before approval." },
          { id: "native-handoff", title: "Hand off to native executor", detail: "Let the NativeBackend continue with visible event ledger records." }
        ],
        verificationCommands: [],
        debateRecommended: true,
        reasonForDebate: "Configured external profile should be challenged by native reviewer/judge until a real command runner is attached."
      }
    };
  }
  if (role === "coder_a" || role === "coder_b" || role === "repairer") {
    return {
      summary: baseSummary,
      candidate: {
        candidateId: `${role}_${profile.id}_configured_candidate`,
        agentId: role,
        approach: role === "repairer" ? "repair" : role === "coder_b" ? "alternative" : "minimal_patch",
        summary: `${baseSummary} No file mutation was proposed by the configured-profile mock.`,
        filesChanged: [],
        unifiedDiff: "",
        testPlan: [],
        knownTradeoffs: ["Attach a real command runner or MCP process for executable external agent output."],
        estimatedRisk: "medium"
      }
    };
  }
  if (role === "reviewer") {
    const candidates = Array.isArray(envelope.context.candidates) ? envelope.context.candidates : [];
    const summary = [
      baseSummary,
      "Reviewer stance: require concrete diff/artifact refs, test evidence, and explicit risk notes before approval.",
      "Judge stance: do not select a candidate with unresolved reviewer blocking concerns."
    ].join(" ");
    return {
      summary,
      review: {
        mode: "standard",
        reviews: candidates.length
          ? candidates.map((candidate, index) => {
            const candidateRecord = asRecord(candidate);
            return {
              candidateId: typeof candidateRecord?.candidateId === "string" ? candidateRecord.candidateId : `candidate_${index + 1}`,
              correctnessScore: 60,
              riskScore: 55,
              invasiveness: "low",
              testCoverage: "weak",
              securityConcerns: [],
              regressionConcerns: ["Configured external profile cannot validate the diff until a real process is attached."],
              redTeamFindings: [],
              recommendation: "revise",
              notes: [baseSummary, "Typed mock review recorded for trace continuity."]
            };
          })
          : [{
            candidateId: "no_candidate",
            correctnessScore: 0,
            riskScore: 80,
            invasiveness: "low",
            testCoverage: "none",
            securityConcerns: [],
            regressionConcerns: ["No candidate was available to review."],
            redTeamFindings: [],
            recommendation: "reject",
            notes: [baseSummary]
          }],
        overallRecommendation: "Configured external reviewer recorded a typed placeholder; native reviewer/judge should remain authoritative."
      }
    };
  }
  if (role === "judge") {
    const summary = [
      baseSummary,
      "Reviewer stance: preserve blocking concerns in the judge handoff.",
      "Judge stance: request revision until a real external command/MCP runner can validate the candidate."
    ].join(" ");
    return {
      summary,
      judgment: {
        decision: "request_revision",
        reason: "Configured external judge did not execute a real process; require native review or attach command/MCP runner before selection.",
        confidence: 0.55
      }
    };
  }
  return {
    summary: baseSummary,
    result: {
      role,
      status: "partial",
      summary: baseSummary,
      payload: { outputContract: envelope.outputContract }
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function phaseForRole(role: AgentRole) {
  if (role === "core" || role === "planner") return "planning";
  if (role === "vision") return "vision";
  if (role === "explorer") return "exploration";
  if (role === "reviewer") return "review";
  if (role === "judge") return "judge";
  if (role === "repairer") return "repair";
  if (role === "runner") return "shell";
  if (role === "summarizer") return "summary";
  return "coding";
}
