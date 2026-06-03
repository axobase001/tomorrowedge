import { existsSync } from "node:fs";
import process from "node:process";
import { getConfigPath, loadConfig } from "../../config/configLoader.js";
import { createProviderRegistry } from "../../providers/registry.js";
import { getGitStatus } from "../../core/tools/gitTool.js";

export async function doctorCommand(cwd: string): Promise<void> {
  const config = loadConfig(cwd);
  const registry = createProviderRegistry(config);
  const configPath = getConfigPath(cwd);
  process.stdout.write("TomorrowEdge doctor\n");
  process.stdout.write(`node: ${process.version}\n`);
  process.stdout.write(`config: ${existsSync(configPath) ? configPath : "default in-memory config"}\n`);
  process.stdout.write(`safe_mode: ${config.project.safe_mode}\n`);
  process.stdout.write(`telemetry: ${config.project.telemetry}\n`);
  process.stdout.write(`routing: ${config.routing.mode}\n`);
  process.stdout.write(`providers: ${registry.list().map((provider) => provider.id).join(", ")}\n`);
  const providerDiagnostics = Object.entries(config.providers)
    .filter(([, provider]) => provider.enabled)
    .map(([id, provider]) => {
      if (!provider.base_url && !["mock", "fixture"].includes(id)) return `${id}: enabled but base_url is missing`;
      if (provider.auth_header !== "none" && provider.api_key_env && !process.env[provider.api_key_env]) return `${id}: missing ${provider.api_key_env}`;
      if (!registry.get(id)) return `${id}: enabled but not registered`;
      return `${id}: ready`;
    });
  if (providerDiagnostics.length) process.stdout.write(`provider diagnostics: ${providerDiagnostics.join("; ")}\n`);
  process.stdout.write(`git: ${await getGitStatus(cwd).catch(() => "not a git repository")}\n`);
  const missingKeys = Object.entries(config.providers)
    .filter(([, provider]) => provider.enabled && provider.api_key_env && !process.env[provider.api_key_env])
    .map(([id, provider]) => `${id}(${provider.api_key_env})`);
  process.stdout.write(`missing keys: ${missingKeys.length ? missingKeys.join(", ") : "none required for offline mode"}\n`);
}
