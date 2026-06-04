import type { AgentRole } from "../../../schemas/agentTask.js";
import type { EventPhase } from "../../events/eventTypes.js";
import type { ExternalAgentRunnerInput, ExternalAgentRunnerResult } from "./runnerTypes.js";

export async function runMockExternalAgent(input: ExternalAgentRunnerInput): Promise<ExternalAgentRunnerResult> {
  const startedAt = Date.now();
  const request = {
    externalAgentId: input.profile.id,
    role: input.role,
    task: input.task,
    context: input.context ?? null
  };
  const requestRef = input.ledger?.writeArtifact("external_agent_request", JSON.stringify(request, null, 2), "json");
  input.ledger?.append({
    type: "external_agent_call",
    phase: phaseForRole(input.role),
    role: input.role,
    provider: `external:${input.profile.id}`,
    model: input.profile.name,
    externalAgentId: input.profile.id,
    tool: "mock.runner",
    status: "start",
    requestRef
  });

  const summary = `${input.profile.name} mock runner completed ${input.role} handoff for: ${input.task}`;
  const result = {
    summary,
    recommendations: ["Keep the handoff traceable.", "Record reviewer and judge decisions before delivery."]
  };
  const resultRef = input.ledger?.writeArtifact("external_agent_result", JSON.stringify(result, null, 2), "json");
  input.ledger?.append({
    type: "external_agent_call",
    phase: phaseForRole(input.role),
    role: input.role,
    provider: `external:${input.profile.id}`,
    model: input.profile.name,
    externalAgentId: input.profile.id,
    tool: "mock.runner",
    status: "success",
    requestRef,
    responseRef: resultRef
  });
  input.ledger?.append({
    type: "external_agent_result",
    phase: phaseForRole(input.role),
    role: input.role,
    provider: `external:${input.profile.id}`,
    model: input.profile.name,
    externalAgentId: input.profile.id,
    resultRef,
    summary
  });

  return {
    ok: true,
    externalAgentId: input.profile.id,
    role: input.role,
    stdout: JSON.stringify(result),
    stderr: "",
    summary,
    durationMs: Date.now() - startedAt,
    requestRef,
    responseRef: resultRef,
    resultRef
  };
}

function phaseForRole(role: AgentRole): EventPhase {
  if (role === "core" || role === "planner") return "planning";
  if (role === "reviewer") return "review";
  if (role === "judge") return "judge";
  if (role === "repairer") return "repair";
  if (role === "runner") return "shell";
  return "coding";
}
