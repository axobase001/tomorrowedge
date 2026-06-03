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
  process.stdout.write(`git: ${await getGitStatus(cwd).catch(() => "not a git repository")}\n`);
  const missingKeys = Object.entries(config.providers)
    .filter(([, provider]) => provider.enabled && provider.api_key_env && !process.env[provider.api_key_env])
    .map(([id, provider]) => `${id}(${provider.api_key_env})`);
  process.stdout.write(`missing keys: ${missingKeys.length ? missingKeys.join(", ") : "none required for offline mode"}\n`);
}
