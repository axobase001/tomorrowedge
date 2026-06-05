import { loadConfig, writeConfig } from "../../config/configLoader.js";
import { accessModeSchema, agentRoleSchema, routingModeSchema, type AccessMode, type RoutingMode } from "../../config/schema.js";
import type { AgentGraphState } from "../../core/agentGraph/state.js";
import { loadProjectPreferences, saveProjectPreferences } from "../../core/memory/preferences.js";
import { buildAccessPolicy } from "../../core/permissions/accessPolicy.js";
import { ModelRouter } from "../../core/routing/router.js";
import type { AgentRole } from "../../schemas/agentTask.js";

export type TuiConfigCommand =
  | { kind: "mode"; mode: AccessMode }
  | { kind: "routing"; mode: RoutingMode }
  | { kind: "model"; role: AgentRole; provider: string; model: string }
  | { kind: "testCommand"; command: string }
  | { kind: "saveRoute" };

export type TuiConfigCommandResult = {
  graph: AgentGraphState;
  message: string;
};

export function parseTuiConfigCommand(text: string): TuiConfigCommand | undefined {
  const trimmed = text.trim();
  const [command, ...parts] = trimmed.split(/\s+/);
  if (command === "/mode") {
    const mode = parts[0];
    const parsed = accessModeSchema.safeParse(mode);
    if (!parsed.success || parts.length !== 1) throw new Error("Usage: /mode restricted|partial|full");
    return { kind: "mode", mode: parsed.data };
  }
  if (command === "/routing") {
    const mode = parts[0];
    const parsed = routingModeSchema.safeParse(mode);
    if (!parsed.success || parts.length !== 1) throw new Error("Usage: /routing cheap|balanced|quality|local|privacy|china");
    return { kind: "routing", mode: parsed.data };
  }
  if (command === "/model") {
    const role = agentRoleSchema.safeParse(parts[0]);
    const provider = parts[1]?.trim();
    const model = parts.slice(2).join(" ").trim();
    if (!role.success || !provider || !model) throw new Error("Usage: /model <role> <provider> <model>");
    if (role.data === "runner") throw new Error("Runner uses the local shell; use /test-command for verification commands.");
    return { kind: "model", role: role.data, provider, model };
  }
  if (command === "/test-command") {
    const command = trimmed.slice("/test-command ".length).trim();
    if (!command) throw new Error('Usage: /test-command "npm test"');
    return { kind: "testCommand", command };
  }
  if (command === "/save-route") {
    if (parts.length > 0) throw new Error("Usage: /save-route");
    return { kind: "saveRoute" };
  }
  return undefined;
}

export async function applyTuiConfigCommand(cwd: string, graph: AgentGraphState, command: TuiConfigCommand): Promise<TuiConfigCommandResult> {
  const config = loadConfig(cwd);
  const prefs = loadProjectPreferences(cwd);

  if (command.kind === "mode") {
    const nextConfig = { ...config, project: { ...config.project, access_mode: command.mode } };
    await writeConfig(cwd, nextConfig);
    await saveProjectPreferences(cwd, { ...prefs, accessMode: command.mode });
    const access = buildAccessPolicy(nextConfig, { mode: command.mode });
    return {
      graph: {
        ...graph,
        access,
        approvals: {
          patchApproved: access.patchApproved,
          shellApproved: access.shellApproved,
          repairApproved: access.repairApproved
        }
      },
      message: `Saved access mode: ${command.mode}.`
    };
  }

  if (command.kind === "routing") {
    const nextConfig = { ...config, routing: { ...config.routing, mode: command.mode } };
    await writeConfig(cwd, nextConfig);
    await saveProjectPreferences(cwd, { ...prefs, routingMode: command.mode });
    return {
      graph: { ...graph, routing: new ModelRouter(nextConfig).getPlan() },
      message: `Saved routing mode: ${command.mode}.`
    };
  }

  if (command.kind === "model") {
    const nextConfig = {
      ...config,
      agents: {
        ...config.agents,
        [command.role]: { provider: command.provider, model: command.model }
      }
    };
    await writeConfig(cwd, nextConfig);
    return {
      graph: { ...graph, routing: new ModelRouter(nextConfig).getPlan() },
      message: `Saved ${command.role} model: ${command.provider}/${command.model}.`
    };
  }

  if (command.kind === "testCommand") {
    await saveProjectPreferences(cwd, { ...prefs, preferredTestCommand: command.command });
    return { graph, message: `Saved preferred test command: ${command.command}.` };
  }

  const nextAgents = { ...config.agents };
  for (const assignment of graph.routing.assignments) {
    if (assignment.provider === "local_tool") continue;
    if (!(assignment.role in nextAgents)) continue;
    nextAgents[assignment.role] = {
      provider: assignment.provider,
      model: assignment.model
    };
  }
  const nextConfig = { ...config, agents: nextAgents };
  await writeConfig(cwd, nextConfig);
  return {
    graph: { ...graph, routing: new ModelRouter(nextConfig).getPlan() },
    message: "Saved current TUI route overrides."
  };
}
