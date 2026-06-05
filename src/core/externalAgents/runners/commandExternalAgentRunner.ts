import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import type { AgentRole } from "../../../schemas/agentTask.js";
import type { EventPhase } from "../../events/eventTypes.js";
import { diagnoseExternalAgentProfile, formatExternalAgentDiagnostic, resolveExternalAgentWorkingDirectory } from "../externalAgentDiagnostics.js";
import type { ExternalAgentRunnerInput, ExternalAgentRunnerResult } from "./runnerTypes.js";

export async function runCommandExternalAgent(input: ExternalAgentRunnerInput): Promise<ExternalAgentRunnerResult> {
  const startedAt = Date.now();
  const request = {
    externalAgentId: input.profile.id,
    role: input.role,
    task: input.task,
    context: input.context ?? null,
    createdAt: new Date().toISOString()
  };
  const requestJson = JSON.stringify(request, null, 2);
  const requestRef = input.ledger?.writeArtifact("external_agent_request", requestJson, "json");
  const phase = phaseForRole(input.role);

  input.ledger?.append({
    type: "external_agent_call",
    phase,
    role: input.role,
    provider: `external:${input.profile.id}`,
    model: input.profile.name,
    externalAgentId: input.profile.id,
    tool: "command.runner",
    status: "start",
    requestRef
  });

  const diagnostic = diagnoseExternalAgentProfile(input.profile, input.cwd);
  if (diagnostic.status === "error") {
    return recordCommandError(input, phase, startedAt, `External agent is not invokable: ${formatExternalAgentDiagnostic(diagnostic)}`, requestRef);
  }
  if (!input.profile.command) {
    return recordCommandError(input, phase, startedAt, "External agent command is not configured.", requestRef);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tedge-external-agent-"));
  const contextPath = path.join(tempDir, "request.json");
  await writeFile(contextPath, requestJson, "utf8");

  try {
    const subprocess = await execa(input.profile.command, input.profile.args ?? [], {
      cwd: resolveExternalAgentWorkingDirectory(input.profile, input.cwd),
      env: {
        ...process.env,
        ...(input.profile.env ?? {}),
        TOMORROWEDGE_EXTERNAL_AGENT_ID: input.profile.id,
        TOMORROWEDGE_EXTERNAL_AGENT_ROLE: input.role,
        TOMORROWEDGE_EXTERNAL_CONTEXT_FILE: contextPath
      },
      input: requestJson,
      reject: false,
      shell: false,
      timeout: input.timeoutMs ?? input.profile.requestTimeoutMs ?? 60_000
    });

    const responsePayload = {
      exitCode: subprocess.exitCode ?? 1,
      stdout: subprocess.stdout,
      stderr: subprocess.stderr
    };
    const responseRef = input.ledger?.writeArtifact("external_agent_response", JSON.stringify(responsePayload, null, 2), "json");
    const summary = summarizeCommandOutput(subprocess.stdout, subprocess.stderr, subprocess.exitCode ?? 1);
    const ok = (subprocess.exitCode ?? 1) === 0;

    input.ledger?.append({
      type: "external_agent_call",
      phase,
      role: input.role,
      provider: `external:${input.profile.id}`,
      model: input.profile.name,
      externalAgentId: input.profile.id,
      tool: "command.runner",
      status: ok ? "success" : "failure",
      requestRef,
      responseRef,
      error: ok ? undefined : summary
    });
    if (ok) {
      input.ledger?.append({
        type: "external_agent_result",
        phase,
        role: input.role,
        provider: `external:${input.profile.id}`,
        model: input.profile.name,
        externalAgentId: input.profile.id,
        resultRef: responseRef,
        summary
      });
    } else {
      input.ledger?.append({
        type: "external_agent_error",
        phase,
        role: input.role,
        provider: `external:${input.profile.id}`,
        model: input.profile.name,
        externalAgentId: input.profile.id,
        error: summary
      });
    }

    return {
      ok,
      externalAgentId: input.profile.id,
      role: input.role,
      stdout: subprocess.stdout,
      stderr: subprocess.stderr,
      summary,
      exitCode: subprocess.exitCode ?? 1,
      durationMs: Date.now() - startedAt,
      requestRef,
      responseRef,
      resultRef: ok ? responseRef : undefined,
      error: ok ? undefined : summary
    };
  } catch (error) {
    return recordCommandError(input, phase, startedAt, error instanceof Error ? error.message : String(error), requestRef);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function recordCommandError(input: ExternalAgentRunnerInput, phase: EventPhase, startedAt: number, error: string, requestRef?: string): ExternalAgentRunnerResult {
  input.ledger?.append({
    type: "external_agent_call",
    phase,
    role: input.role,
    provider: `external:${input.profile.id}`,
    model: input.profile.name,
    externalAgentId: input.profile.id,
    tool: "command.runner",
    status: "failure",
    requestRef,
    error
  });
  input.ledger?.append({
    type: "external_agent_error",
    phase,
    role: input.role,
    provider: `external:${input.profile.id}`,
    model: input.profile.name,
    externalAgentId: input.profile.id,
    error
  });
  return {
    ok: false,
    externalAgentId: input.profile.id,
    role: input.role,
    stdout: "",
    stderr: error,
    summary: error,
    durationMs: Date.now() - startedAt,
    requestRef,
    error
  };
}

function summarizeCommandOutput(stdout: string, stderr: string, exitCode: number): string {
  const text = stdout.trim() || stderr.trim() || `external command exited with code ${exitCode}`;
  return text.split(/\r?\n/).slice(0, 4).join(" ").slice(0, 500);
}

function phaseForRole(role: AgentRole): EventPhase {
  if (role === "core" || role === "planner") return "planning";
  if (role === "reviewer") return "review";
  if (role === "judge") return "judge";
  if (role === "repairer") return "repair";
  if (role === "runner") return "shell";
  return "coding";
}
