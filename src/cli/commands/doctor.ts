import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";
import { getConfigPath, loadConfig } from "../../config/configLoader.js";
import type { ProviderConfig, TomorrowEdgeConfig } from "../../config/schema.js";
import { createProviderRegistry } from "../../providers/registry.js";
import { getGitStatus } from "../../core/tools/gitTool.js";
import { estimateCostUsd } from "../../core/model/costAccounting.js";
import { profilesFromConfig } from "../../core/routing/modelProfiles.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../../package.json") as { version: string };

export type DoctorOptions = {
  json?: boolean;
};

export type DoctorDiagnostic = {
  id: string;
  status: "ready" | "warning" | "error";
  checks: string[];
  fix?: string;
};

export async function doctorCommand(cwd: string, options: DoctorOptions = {}): Promise<void> {
  const config = loadConfig(cwd);
  const registry = createProviderRegistry(config);
  const configPath = getConfigPath(cwd);
  const diagnostics = buildProviderDiagnostics(config);
  const git = await getGitStatus(cwd).catch(() => "not a git repository");
  const warnings = buildWorkspaceWarnings(config, git);
  const payload = {
    node: process.version,
    config: existsSync(configPath) ? configPath : "default in-memory config",
    safeMode: config.project.safe_mode,
    telemetry: config.project.telemetry,
    routing: config.routing.mode,
    orchestration: config.orchestration.backend,
    registeredProviders: registry.list().map((provider) => provider.id),
    providerDiagnostics: diagnostics,
    git,
    warnings,
    mcpBridge: "experimental; stdio server and tool listing are available, external agent bridge depends on external_agents config"
  };
  if (options.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }
  process.stdout.write("TomorrowEdge doctor\n");
  process.stdout.write(`node: ${payload.node}\n`);
  process.stdout.write(`config: ${payload.config}\n`);
  process.stdout.write(`safe_mode: ${payload.safeMode}\n`);
  process.stdout.write(`telemetry: ${payload.telemetry}\n`);
  process.stdout.write(`routing: ${payload.routing}\n`);
  process.stdout.write(`orchestration: ${payload.orchestration}\n`);
  process.stdout.write(`providers: ${payload.registeredProviders.join(", ")}\n`);
  process.stdout.write(`mcp bridge: ${payload.mcpBridge}\n`);
  process.stdout.write(`git: ${payload.git}\n`);
  if (warnings.length) {
    process.stdout.write("warnings:\n");
    for (const warning of warnings) process.stdout.write(`- ${warning}\n`);
  }
  process.stdout.write("provider diagnostics:\n");
  for (const diagnostic of diagnostics) {
    process.stdout.write(`- ${diagnostic.id}: ${diagnostic.status}; ${diagnostic.checks.join("; ")}\n`);
    if (diagnostic.fix) process.stdout.write(`  fix: ${diagnostic.fix}\n`);
  }
}

function buildWorkspaceWarnings(config: TomorrowEdgeConfig, gitStatus: string): string[] {
  const warnings: string[] = [];
  if (config.orchestration.backend !== "native") {
    warnings.push(`orchestration.backend=${config.orchestration.backend} is registered but not executable in ${packageJson.version}; use native for real runs.`);
  }
  if (config.project.access_mode === "full") {
    warnings.push("full access mode auto-approves patch, shell, and repair actions.");
    if (gitStatus !== "clean" && gitStatus !== "not a git repository") {
      warnings.push(`full mode is configured while the workspace is ${gitStatus}; prefer a clean repo, sandbox, or fixture.`);
    }
  }
  return warnings;
}

function buildProviderDiagnostics(config: TomorrowEdgeConfig): DoctorDiagnostic[] {
  const profiles = profilesFromConfig(config);
  return Object.entries(config.providers)
    .filter(([, provider]) => provider.enabled)
    .map(([id, provider]) => diagnoseProvider(id, provider, profiles.some((profile) => profile.provider === id)));
}

function diagnoseProvider(id: string, provider: ProviderConfig, hasProfile: boolean): DoctorDiagnostic {
  const checks: string[] = [];
  let status: DoctorDiagnostic["status"] = "ready";
  let fix: string | undefined;

  if (["mock", "fixture", "ollama"].includes(id)) checks.push("offline/local provider does not require API key");
  if (["anthropic", "gemini"].includes(id)) checks.push("native protocol adapter available");
  if (!provider.model?.trim()) {
    status = "warning";
    checks.push("model is not configured");
    fix = `Set providers.${id}.model in .tomorrowedge/config.yaml.`;
  } else {
    checks.push(`model=${provider.model}`);
  }
  if (!provider.base_url && !["mock", "fixture"].includes(id)) {
    status = "error";
    checks.push("base_url is missing");
    fix = `Set providers.${id}.base_url or disable providers.${id}.enabled.`;
  } else if (provider.base_url) {
    checks.push(isValidUrl(provider.base_url) ? "base_url syntax ok" : "base_url is not a valid URL");
    if (!isValidUrl(provider.base_url)) {
      status = "error";
      fix = `Use an absolute http(s) URL for providers.${id}.base_url.`;
    }
  }
  if (provider.auth_header !== "none" && provider.api_key_env && !process.env[provider.api_key_env]) {
    status = "error";
    checks.push(`missing env ${provider.api_key_env}`);
    fix = `Set ${provider.api_key_env} in your shell or disable providers.${id}.enabled.`;
  }
  if (id === "ollama" && status !== "error") {
    status = "warning";
    checks.push("local HTTP connectivity not checked by doctor");
    fix = "Run `tedge models --connection-test --provider ollama` while Ollama is running.";
  }
  if (!hasProfile) {
    status = status === "error" ? status : "warning";
    checks.push("no routing profile registered");
  }
  const localOrOffline = ["mock", "fixture", "ollama"].includes(id);
  const estimated = estimateCostUsd(id, { inputTokens: 1000, outputTokens: 1000 });
  if (localOrOffline) {
    checks.push("price not required for offline/local provider");
  } else {
    checks.push(estimated === undefined ? "price unknown" : `price defaults available (~$${estimated}/1k+1k tokens)`);
    if (estimated === undefined && status === "ready") status = "warning";
  }
  return { id, status, checks, fix };
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
