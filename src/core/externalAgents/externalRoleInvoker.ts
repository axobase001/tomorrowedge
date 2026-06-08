import type { AgentRole } from "../../schemas/agentTask.js";
import type { EventLedger } from "../events/eventLedger.js";
import type { ExternalAgentProfile } from "./externalAgentTypes.js";
import { ExternalAgentProcessClient, type ExternalAgentTool } from "./externalAgentProcess.js";
import { runCommandExternalAgent } from "./runners/commandExternalAgentRunner.js";
import type { ExternalOutputContract, ExternalTaskEnvelope } from "./contracts/externalTaskEnvelope.js";

export type ExternalRoleInvocation = {
  externalAgentId: string;
  role: AgentRole;
  payload: unknown;
  summary: string;
  attempts: number;
};

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
    const payload = parseJsonish(result.stdout) ?? { summary: result.summary, stdout: result.stdout };
    return {
      externalAgentId: input.profile.id,
      role: input.role,
      payload,
      summary: result.summary,
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

  const client = new ExternalAgentProcessClient(input.profile, input.cwd);
  try {
    await client.start();
    const tools = await client.listTools();
    const toolName = input.toolName ?? chooseExternalTool(tools);
    const result = await client.callTool(toolName, {
      role: input.role,
      prompt: input.prompt,
      context: envelope,
      outputContract: envelope.outputContract
    });
    if (!result.ok) throw new Error(result.error ?? "External MCP tool call failed.");
    const payload = unwrapMcpToolResult(result.result);
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
      summary: summarizePayload(payload, `External MCP process returned ${toolName}.`)
    });
    return {
      externalAgentId: input.profile.id,
      role: input.role,
      payload,
      summary: summarizePayload(payload, `External MCP process returned ${toolName}.`),
      attempts: result.attempts
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
    await client.stop();
  }
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
