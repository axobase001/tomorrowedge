import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { defaultConfig } from "./defaultConfig.js";
import { loadLocalEnv } from "./envLoader.js";
import { configSchema, type TomorrowEdgeConfig } from "./schema.js";

export const configDirName = ".tomorrowedge";
export const configFileName = "config.yaml";

export function getConfigPath(cwd: string): string {
  return path.join(cwd, configDirName, configFileName);
}

export function loadConfig(cwd: string): TomorrowEdgeConfig {
  loadLocalEnv(cwd);
  const configPath = getConfigPath(cwd);
  if (!existsSync(configPath)) {
    return defaultConfig;
  }
  const parsed = YAML.parse(readFileSync(configPath, "utf8")) as unknown;
  const config = withKnownProviderDefaults(configSchema.parse(deepMerge(defaultConfig, parsed)));
  validateAgentProviderReferences(config);
  return config;
}

export type WriteDefaultConfigResult = {
  path: string;
  created: boolean;
  overwritten: boolean;
};

export async function writeDefaultConfig(cwd: string, options: { force?: boolean } = {}): Promise<WriteDefaultConfigResult> {
  const dir = path.join(cwd, configDirName);
  await mkdir(dir, { recursive: true });
  const configPath = getConfigPath(cwd);
  if (existsSync(configPath)) {
    if (!options.force) {
      return { path: configPath, created: false, overwritten: false };
    }
    await writeFile(configPath, YAML.stringify(defaultConfig), "utf8");
    return { path: configPath, created: false, overwritten: true };
  }
  await writeFile(configPath, YAML.stringify(defaultConfig), "utf8");
  return { path: configPath, created: true, overwritten: false };
}

export async function writeConfig(cwd: string, config: TomorrowEdgeConfig): Promise<string> {
  const dir = path.join(cwd, configDirName);
  await mkdir(dir, { recursive: true });
  const configPath = getConfigPath(cwd);
  await writeFile(configPath, YAML.stringify(config), "utf8");
  return configPath;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) {
    return override ?? base;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = deepMerge(merged[key], value);
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function withKnownProviderDefaults(config: TomorrowEdgeConfig): TomorrowEdgeConfig {
  const providers: TomorrowEdgeConfig["providers"] = { ...config.providers };
  for (const [id, provider] of Object.entries(providers)) {
    const defaultProvider = defaultConfig.providers[id];
    let nextProvider = provider;
    if (!provider.base_url.trim() && defaultProvider?.base_url) {
      nextProvider = { ...nextProvider, base_url: defaultProvider.base_url };
    }
    if (!provider.models.length && defaultProvider?.models.length) {
      nextProvider = { ...nextProvider, models: defaultProvider.models };
    }
    providers[id] = nextProvider;
  }
  return { ...config, providers };
}

function validateAgentProviderReferences(config: TomorrowEdgeConfig): void {
  const providerIds = new Set(Object.keys(config.providers));
  const externalAgentIds = new Set(Object.keys(config.external_agents));
  for (const [role, agent] of Object.entries(config.agents)) {
    const provider = agent.provider.trim();
    if (!provider) {
      throw new Error(`Agent "${role}" has an empty provider reference.`);
    }
    if (provider === "auto") continue;
    if (provider.startsWith("external:")) {
      const externalId = provider.slice("external:".length);
      if (!externalAgentIds.has(externalId)) {
        throw new Error(`Agent "${role}" references unknown external agent "${externalId}".`);
      }
      continue;
    }
    if (!providerIds.has(provider)) {
      throw new Error(`Agent "${role}" references unknown provider "${provider}".`);
    }
  }
}
