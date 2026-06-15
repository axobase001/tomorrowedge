import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { defaultConfig } from "./defaultConfig.js";
import { loadLocalEnv } from "./envLoader.js";
import { configSchema, type TomorrowEdgeConfig } from "./schema.js";

export const configDirName = ".tomorrowedge";
export const configFileName = "config.yaml";

export function getConfigPath(cwd: string): string {
  return path.join(cwd, configDirName, configFileName);
}

export type ConfigSourceKind = "default" | "project" | "explicit";

export type ConfigLoadOptions = {
  configPath?: string;
};

export type LoadedConfig = {
  config: TomorrowEdgeConfig;
  source: ConfigSourceKind;
  path?: string;
};

export function loadConfig(cwd: string): TomorrowEdgeConfig {
  return loadConfigWithSource(cwd).config;
}

export function loadConfigWithSource(cwd: string, options: ConfigLoadOptions = {}): LoadedConfig {
  loadLocalEnv(cwd);
  const explicitPath = options.configPath?.trim();
  if (explicitPath) {
    const resolved = path.isAbsolute(explicitPath) ? explicitPath : path.resolve(cwd, explicitPath);
    if (!existsSync(resolved)) {
      throw new Error(`Explicit config not found: ${resolved}`);
    }
    return {
      source: "explicit",
      path: resolved,
      config: parseConfigFile(resolved, cwd)
    };
  }

  const configPath = getConfigPath(cwd);
  if (!existsSync(configPath)) {
    return {
      source: "default",
      config: finalizeConfig(defaultConfig, cwd)
    };
  }
  return {
    source: "project",
    path: configPath,
    config: parseConfigFile(configPath, cwd)
  };
}

export function packageRootPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function parseConfigFile(configPath: string, cwd: string): TomorrowEdgeConfig {
  const parsed = YAML.parse(readFileSync(configPath, "utf8")) as unknown;
  return finalizeConfig(deepMerge(defaultConfig, parsed), cwd, configPath);
}

function finalizeConfig(raw: unknown, cwd: string, configPath?: string): TomorrowEdgeConfig {
  let config = withKnownProviderDefaults(configSchema.parse(raw));
  config = withResolvedExternalAgentPaths(config, {
    projectRoot: cwd,
    configDir: configPath ? path.dirname(configPath) : cwd,
    packageRoot: packageRootPath()
  });
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

type ConfigPathContext = {
  projectRoot: string;
  configDir: string;
  packageRoot: string;
};

function withResolvedExternalAgentPaths(config: TomorrowEdgeConfig, context: ConfigPathContext): TomorrowEdgeConfig {
  const externalAgents: TomorrowEdgeConfig["external_agents"] = {};
  for (const [id, agent] of Object.entries(config.external_agents)) {
    const resolvedEnv = Object.fromEntries(
      Object.entries(agent.env ?? {}).map(([key, value]) => [key, expandConfigPlaceholders(value, context)])
    );
    externalAgents[id] = {
      ...agent,
      command: resolveConfigPathLike(agent.command, context, { resolveOnlyPathLike: true }),
      args: (agent.args ?? []).map((arg) => resolveConfigPathLike(arg, context, { resolveOnlyPathLike: true })),
      cwd: agent.cwd ? resolveConfigPathLike(agent.cwd, context, { resolveOnlyPathLike: false }) : undefined,
      env: resolvedEnv
    };
  }
  return { ...config, external_agents: externalAgents };
}

function resolveConfigPathLike(value: string, context: ConfigPathContext, options: { resolveOnlyPathLike: boolean }): string {
  const expanded = expandConfigPlaceholders(value, context);
  if (!expanded.trim()) return expanded;
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  if (options.resolveOnlyPathLike && !looksLikePath(expanded)) return expanded;

  const configRelative = path.resolve(context.configDir, expanded);
  if (existsSync(configRelative)) return configRelative;

  const packageRelative = path.resolve(context.packageRoot, expanded);
  if (existsSync(packageRelative)) return packageRelative;

  const projectRelative = path.resolve(context.projectRoot, expanded);
  if (existsSync(projectRelative)) return projectRelative;

  return configRelative;
}

function expandConfigPlaceholders(value: string, context: ConfigPathContext): string {
  return value
    .replaceAll("${TOMORROWEDGE_ROOT}", context.packageRoot)
    .replaceAll("${CONFIG_DIR}", context.configDir)
    .replaceAll("${PROJECT_ROOT}", context.projectRoot);
}

function looksLikePath(value: string): boolean {
  if (value.includes("/") || value.includes("\\")) return true;
  return /\.(mjs|cjs|js|json|ya?ml|ts|tsx|py|sh|cmd|ps1|exe)$/i.test(value);
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
