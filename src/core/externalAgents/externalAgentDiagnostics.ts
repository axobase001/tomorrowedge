import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { ExternalAgentProfile } from "./externalAgentTypes.js";

export type ExternalAgentDiagnosticStatus = "ready" | "warning" | "error";

export type ExternalAgentDiagnostic = {
  id: string;
  name: string;
  status: ExternalAgentDiagnosticStatus;
  mode: "stdio_mcp" | "command_runner" | "manual_bridge";
  command?: string;
  args: string[];
  resolvedCommand?: string;
  cwd: string;
  checks: string[];
  fix?: string;
  detectedCommand?: {
    command: string;
    args: string[];
    detail: string;
  };
};

export function diagnoseExternalAgentProfile(profile: ExternalAgentProfile, cwd: string, env: NodeJS.ProcessEnv = process.env): ExternalAgentDiagnostic {
  const checks: string[] = [];
  let status: ExternalAgentDiagnosticStatus = "ready";
  let fix: string | undefined;
  const resolvedCwd = resolveExternalAgentWorkingDirectory(profile, cwd);
  const command = profile.command?.trim();
  const mode = command ? (profile.autoStart ? "stdio_mcp" : "command_runner") : "manual_bridge";

  if (!profile.allowedRoles.length) {
    status = "warning";
    checks.push("no allowed roles configured");
    fix = `Set external_agents.${profile.id}.roles to at least one workflow role.`;
  } else {
    checks.push(`roles=${profile.allowedRoles.join(",")}`);
  }

  if (!profile.capabilities.length) {
    if (status === "ready") status = "warning";
    checks.push("no capabilities configured");
    fix ??= `Set external_agents.${profile.id}.capabilities to describe what the agent can do.`;
  } else {
    checks.push(`capabilities=${profile.capabilities.join(",")}`);
  }

  if (!existsSync(resolvedCwd)) {
    status = "error";
    checks.push(`cwd missing: ${resolvedCwd}`);
    fix = `Create ${resolvedCwd} or update external_agents.${profile.id}.cwd.`;
  } else if (!statSync(resolvedCwd).isDirectory()) {
    status = "error";
    checks.push(`cwd is not a directory: ${resolvedCwd}`);
    fix = `Set external_agents.${profile.id}.cwd to a directory.`;
  } else {
    checks.push(`cwd=${resolvedCwd}`);
  }

  const detectedCommand = detectKnownExternalAgentCommand(profile.id, env);
  if (!command) {
    if (status === "ready") status = "warning";
    checks.push("command not configured; agent can only submit results into TomorrowEdge, not be invoked by it");
    fix ??= detectedCommand
      ? `Set external_agents.${profile.id}.command=${detectedCommand.command}, args=[${detectedCommand.args.join(", ")}], and autoStart=true.`
      : `Set external_agents.${profile.id}.command and args, then run tedge mcp agents --probe.`;
  } else {
    const resolution = resolveExternalAgentCommand(command, resolvedCwd, env);
    if (resolution.ok) {
      checks.push(`command found: ${resolution.path}`);
    } else {
      status = "error";
      checks.push(resolution.detail);
      fix = detectedCommand
        ? `Use detected ${detectedCommand.command} with args=[${detectedCommand.args.join(", ")}], or fix external_agents.${profile.id}.command.`
        : `Install ${command} or update external_agents.${profile.id}.command.`;
    }
  }

  checks.push(profile.autoStart ? "autoStart=true: stdio MCP process mode" : "autoStart=false: command runner/manual submission mode");
  return {
    id: profile.id,
    name: profile.name,
    status,
    mode,
    command,
    args: profile.args ?? [],
    resolvedCommand: command ? resolveExternalAgentCommand(command, resolvedCwd, env).path : undefined,
    cwd: resolvedCwd,
    checks,
    fix,
    detectedCommand
  };
}

export function formatExternalAgentDiagnostic(diagnostic: ExternalAgentDiagnostic): string {
  const fix = diagnostic.fix ? ` fix: ${diagnostic.fix}` : "";
  return `${diagnostic.status}; mode=${diagnostic.mode}; ${diagnostic.checks.join("; ")}${fix}`;
}

export function resolveExternalAgentWorkingDirectory(profile: ExternalAgentProfile, cwd: string): string {
  const configured = profile.cwd?.trim();
  if (!configured) return cwd;
  return path.isAbsolute(configured) ? configured : path.resolve(cwd, configured);
}

type CommandResolution = {
  ok: boolean;
  path?: string;
  detail: string;
};

function resolveExternalAgentCommand(command: string, cwd: string, env: NodeJS.ProcessEnv): CommandResolution {
  if (hasPathSeparator(command) || path.isAbsolute(command)) {
    const absolute = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    return inspectCommandPath(absolute, command);
  }

  for (const dir of pathEntries(env)) {
    for (const candidate of commandCandidates(command, env)) {
      const absolute = path.join(dir, candidate);
      const inspected = inspectCommandPath(absolute, command);
      if (inspected.ok) return inspected;
    }
  }
  return { ok: false, detail: `command not found on PATH: ${command}` };
}

function detectKnownExternalAgentCommand(id: string, env: NodeJS.ProcessEnv): ExternalAgentDiagnostic["detectedCommand"] {
  const key = id.toLowerCase();
  if (key.includes("codex")) {
    const command = firstAvailableCommand(["codex", "codex.cmd", "codex.exe", "codex.ps1"], env);
    return command ? { command, args: ["mcp-server"], detail: "Codex MCP server launcher detected on PATH." } : undefined;
  }
  if (key.includes("claude")) {
    const command = firstAvailableCommand(["claude", "claude.cmd", "claude.exe", "claude.ps1"], env);
    return command ? { command, args: [], detail: "Claude CLI detected; configure a stdio MCP wrapper or command supported by your Claude Code install." } : undefined;
  }
  return undefined;
}

function firstAvailableCommand(commands: string[], env: NodeJS.ProcessEnv): string | undefined {
  for (const command of commands) {
    if (resolveExternalAgentCommand(command, process.cwd(), env).ok) return command;
  }
  return undefined;
}

function inspectCommandPath(absolute: string, original: string): CommandResolution {
  if (!existsSync(absolute)) return { ok: false, detail: `command path not found for ${original}: ${absolute}` };
  if (!statSync(absolute).isFile()) return { ok: false, detail: `command path is not a file for ${original}: ${absolute}` };
  if (process.platform !== "win32") {
    try {
      accessSync(absolute, constants.X_OK);
    } catch {
      return { ok: false, detail: `command path is not executable for ${original}: ${absolute}` };
    }
  }
  return { ok: true, path: absolute, detail: `command found: ${absolute}` };
}

function commandCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") return [command];
  const extensions = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.PS1").split(";").filter(Boolean);
  const hasExtension = Boolean(path.extname(command));
  const candidates = hasExtension ? [command] : [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`), ...extensions.map((extension) => `${command}${extension.toUpperCase()}`)];
  return [...new Set(candidates)];
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? "").split(path.delimiter).filter(Boolean);
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}
