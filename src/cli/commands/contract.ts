import { loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";

export async function contractInspectCommand(cwd: string, sessionId = "latest", options: { json?: boolean } = {}): Promise<void> {
  const session = sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  const contract = session.state.objectiveContract;
  const verification = session.state.contractVerification;
  if (!contract) {
    process.stdout.write("No Objective Contract recorded for this session.\n");
    return;
  }
  if (options.json) {
    process.stdout.write(JSON.stringify({ contract, verification }, null, 2) + "\n");
    return;
  }
  process.stdout.write([
    `Objective Contract ${contract.contractId}`,
    `Session: ${session.sessionId}`,
    `Scenario: ${contract.scenarioType}`,
    `Workflow: ${contract.workflowKind}`,
    `Risk: ${contract.riskLevel}`,
    `Source: ${contract.source}`,
    `Verification: ${verification?.status ?? "unknown"} score=${verification?.score ?? "-"}`,
    "",
    `Local objective: ${contract.localObjective}`,
    "",
    "Success criteria:",
    ...contract.successCriteria.map((item) => `- ${item}`),
    "",
    "Required evidence:",
    ...contract.requiredEvidence.map((item) => `- ${item}`),
    "",
    "Allowed tools:",
    `- ${contract.allowedTools.join(", ") || "-"}`,
    "",
    "Forbidden actions:",
    `- ${contract.forbiddenActions.join(", ") || "-"}`,
    "",
    "Stop condition:",
    `- success: ${contract.stopCondition.success.join(" | ")}`,
    `- partial: ${contract.stopCondition.partial.join(" | ")}`,
    `- failure: ${contract.stopCondition.failure.join(" | ")}`,
    `- unsafe: ${contract.stopCondition.unsafe.join(" | ")}`,
    ""
  ].join("\n"));
}

