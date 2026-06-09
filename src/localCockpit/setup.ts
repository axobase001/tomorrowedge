import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, writeConfig } from "../config/configLoader.js";
import type { ProviderConfig, TomorrowEdgeConfig } from "../config/schema.js";
import { testProviderConnection, type ProviderConnectionResult } from "../providers/connectionTest.js";
import { log } from "../utils/logger.js";

export type CockpitProviderReadiness = {
  id: string;
  enabled: boolean;
  model: string;
  baseUrl: string;
  apiKeyEnv?: string;
  keyConfigured: boolean;
  keySource: "env" | "local_env" | "not_required" | "missing";
  maskedKey?: string;
  authRequired: boolean;
};

export type CockpitRoleAssignment = {
  role: string;
  provider: string;
  model: string;
  reason?: string;
};

export type CockpitExternalAgentOption = {
  id: string;
  provider: string;
  name: string;
  roles: string[];
  capabilities: string[];
};

export type CockpitSetupStatus = {
  needsSetup: boolean;
  recommendedProvider: string;
  configPath: string;
  providers: CockpitProviderReadiness[];
  externalAgents: CockpitExternalAgentOption[];
  roleAssignments: CockpitRoleAssignment[];
  selectedProvider?: string;
  selectedModel?: string;
};

export type CockpitSetupRequest = {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  bindRoles?: boolean;
};

export type CockpitProviderKeyRequest = {
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey: string;
};

export type CockpitRoleAssignmentsRequest = {
  assignments: CockpitRoleAssignment[];
};

const defaultEnvNames: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  kimi: "KIMI_API_KEY",
  mimo: "MIMO_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai_compatible: "OPENAI_API_KEY"
};

export function getCockpitSetupStatus(cwd: string): CockpitSetupStatus {
  const config = loadConfig(cwd);
  const localEnv = readLocalEnvMap(cwd);
  const providers = Object.entries(config.providers).map(([id, provider]) => providerReadiness(id, provider, localEnv));
  const roleAssignments = Object.entries(config.agents).map(([role, agent]) => ({
    role,
    provider: agent.provider,
    model: agent.model,
    reason: agent.reason
  }));
  const assignedProviders = new Set(roleAssignments.map((assignment) => assignment.provider));
  const configuredLive = providers.find((provider) => provider.enabled && provider.authRequired && provider.keyConfigured && provider.model)
    ?? providers.find((provider) => provider.enabled && !provider.authRequired && provider.keyConfigured && provider.model && assignedProviders.has(provider.id));
  const configuredAuthProvider = providers.find((provider) => provider.enabled && provider.authRequired && provider.model);
  const configuredExternal = externalAgentOptions(config).find((agent) => assignedProviders.has(agent.provider));
  const selected = configuredLive ?? configuredAuthProvider;
  const selectedExternalAssignment = configuredExternal
    ? roleAssignments.find((assignment) => assignment.provider === configuredExternal.provider)
    : undefined;
  return {
    needsSetup: !configuredLive && !configuredExternal,
    recommendedProvider: config.model_discovery.recommended_provider,
    configPath: path.join(cwd, ".tomorrowedge", "config.yaml"),
    providers,
    externalAgents: externalAgentOptions(config),
    roleAssignments,
    selectedProvider: selected?.id ?? configuredExternal?.provider,
    selectedModel: selected?.model ?? selectedExternalAssignment?.model
  };
}

function externalAgentOptions(config: TomorrowEdgeConfig): CockpitExternalAgentOption[] {
  return Object.entries(config.external_agents)
    .filter(([, agent]) => agent.enabled)
    .map(([id, agent]) => ({
      id,
      provider: `external:${id}`,
      name: agent.name || id,
      roles: agent.roles,
      capabilities: agent.capabilities
    }));
}

export async function configureCockpitProvider(cwd: string, request: CockpitSetupRequest): Promise<CockpitSetupStatus> {
  const config = loadConfig(cwd);
  const providerId = normalizeProviderId(request.provider);
  const currentProvider = providerConfigForSetup(config, providerId);
  const model = request.model.trim();
  if (!model) throw new Error("At least one model id is required.");
  const baseUrl = sanitizeBaseUrl(request.baseUrl) ?? currentProvider.base_url;
  if (!baseUrl) throw new Error("Base URL is required for this provider.");
  const apiKeyEnv = sanitizeEnvName(request.apiKeyEnv) ?? currentProvider.api_key_env ?? defaultEnvNameFor(providerId);
  if (requiresAuth(currentProvider) && !apiKeyEnv) throw new Error("API key env var name is required for this provider.");
  if (request.apiKey?.trim() && apiKeyEnv) {
    await writeLocalEnvValue(cwd, apiKeyEnv, request.apiKey.trim());
    process.env[apiKeyEnv] = request.apiKey.trim();
  }
  const nextProvider: ProviderConfig = {
    ...currentProvider,
    enabled: true,
    model,
    base_url: baseUrl,
    api_key_env: apiKeyEnv
  };
  const nextConfig: TomorrowEdgeConfig = {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: nextProvider
    },
    agents: request.bindRoles ? bindAllRoles(config, providerId, model) : config.agents
  };
  await writeConfig(cwd, nextConfig);
  return getCockpitSetupStatus(cwd);
}

export async function saveCockpitProviderKey(cwd: string, request: CockpitProviderKeyRequest): Promise<CockpitSetupStatus> {
  const config = loadConfig(cwd);
  const providerId = normalizeProviderId(request.provider);
  const currentProvider = providerConfigForSetup(config, providerId);
  const apiKey = request.apiKey.trim();
  if (!apiKey) throw new Error("API key is required.");
  const apiKeyEnv = sanitizeEnvName(request.apiKeyEnv) ?? currentProvider.api_key_env ?? defaultEnvNameFor(providerId);
  if (!apiKeyEnv) throw new Error("API key env var name is required for this provider.");
  const model = request.model?.trim() || currentProvider.model;
  if (!model) throw new Error("At least one model id is required.");
  const baseUrl = sanitizeBaseUrl(request.baseUrl) ?? currentProvider.base_url;
  if (!baseUrl) throw new Error("Base URL is required for this provider.");
  await writeLocalEnvValue(cwd, apiKeyEnv, apiKey);
  process.env[apiKeyEnv] = apiKey;
  await writeConfig(cwd, {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: {
        ...currentProvider,
        enabled: true,
        model,
        base_url: baseUrl,
        api_key_env: apiKeyEnv
      }
    }
  });
  return getCockpitSetupStatus(cwd);
}

export async function deleteCockpitProviderKey(cwd: string, providerIdValue: string): Promise<CockpitSetupStatus> {
  const config = loadConfig(cwd);
  const providerId = normalizeProviderId(providerIdValue);
  const provider = config.providers[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  const apiKeyEnv = provider.api_key_env ?? defaultEnvNameFor(providerId);
  if (apiKeyEnv) {
    const previous = await removeLocalEnvValue(cwd, apiKeyEnv);
    if (previous !== undefined && process.env[apiKeyEnv] === previous) delete process.env[apiKeyEnv];
  }
  await writeConfig(cwd, {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: {
        ...provider,
        enabled: false
      }
    }
  });
  return getCockpitSetupStatus(cwd);
}

export async function saveCockpitRoleAssignments(cwd: string, request: CockpitRoleAssignmentsRequest): Promise<CockpitSetupStatus> {
  const config = loadConfig(cwd);
  const agents: TomorrowEdgeConfig["agents"] = { ...config.agents };
  for (const assignment of request.assignments) {
    if (!Object.hasOwn(config.agents, assignment.role)) continue;
    const provider = assignment.provider.trim();
    const model = assignment.model.trim();
    if (!provider || !model) throw new Error(`Role ${assignment.role} requires provider and model.`);
    if (provider.startsWith("external:") && !config.external_agents[provider.slice("external:".length)]) {
      throw new Error(`Role ${assignment.role} references unknown external agent: ${provider}`);
    }
    if (provider !== "auto" && !provider.startsWith("external:") && !config.providers[provider]) {
      throw new Error(`Role ${assignment.role} references unknown provider: ${provider}`);
    }
    agents[assignment.role] = {
      provider,
      model,
      reason: "Configured from GUI key and role manager"
    };
  }
  await writeConfig(cwd, { ...config, agents });
  return getCockpitSetupStatus(cwd);
}

export async function testCockpitProvider(cwd: string, providerId: string): Promise<ProviderConnectionResult> {
  const config = loadConfig(cwd);
  const normalized = normalizeProviderId(providerId);
  const provider = config.providers[normalized];
  if (!provider) throw new Error(`Unknown provider: ${normalized}`);
  return testProviderConnection(normalized, provider);
}

function providerReadiness(id: string, provider: ProviderConfig, localEnv: Map<string, string>): CockpitProviderReadiness {
  const authRequired = requiresAuth(provider);
  const envName = provider.api_key_env;
  const envValue = envName ? process.env[envName] : undefined;
  const localValue = envName ? localEnv.get(envName) : undefined;
  const keyValue = envValue ?? localValue;
  return {
    id,
    enabled: provider.enabled,
    model: provider.model,
    baseUrl: provider.base_url,
    apiKeyEnv: envName,
    keyConfigured: !authRequired || Boolean(keyValue),
    keySource: !authRequired ? "not_required" : localValue ? "local_env" : envValue ? "env" : "missing",
    maskedKey: keyValue ? maskKey(keyValue) : undefined,
    authRequired
  };
}

function requiresAuth(provider: ProviderConfig): boolean {
  return provider.auth_header !== "none";
}

function providerConfigForSetup(config: TomorrowEdgeConfig, providerId: string): ProviderConfig {
  return config.providers[providerId] ?? {
    enabled: false,
    api_key_env: defaultEnvNameFor(providerId),
    base_url: "",
    model: "",
    api_format: "openai_chat",
    auth_header: "bearer",
    extra_headers: {}
  };
}

function defaultEnvNameFor(providerId: string): string {
  const known = defaultEnvNames[providerId];
  if (known) return known;
  const prefix = providerId.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return /^[A-Z_]/.test(prefix) ? `${prefix}_API_KEY` : `PROVIDER_${prefix}_API_KEY`;
}

function normalizeProviderId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
  if (!normalized) throw new Error("Provider id is required.");
  return normalized;
}

function sanitizeEnvName(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^[A-Z_][A-Z0-9_]*$/.test(trimmed)) throw new Error("Env var name must use uppercase letters, numbers, and underscores.");
  return trimmed;
}

function sanitizeBaseUrl(value?: string): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Base URL must be an absolute http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Base URL must use http or https.");
  }
  return trimmed;
}

async function writeLocalEnvValue(cwd: string, key: string, value: string): Promise<void> {
  const dir = path.join(cwd, ".tomorrowedge");
  const envPath = path.join(dir, "local.env");
  await mkdir(dir, { recursive: true });
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const nextLine = `${key}="${escaped}"`;
  let existing = "";
  try {
    existing = await readFile(envPath, "utf8");
  } catch {
    // Missing local env file is the normal first-run path.
  }
  const lines = existing.split(/\r?\n/).filter((line) => line.trim() && !line.trimStart().startsWith(`${key}=`));
  lines.push(nextLine);
  await writeFile(envPath, `${lines.join("\n")}\n`, "utf8");
}

async function removeLocalEnvValue(cwd: string, key: string): Promise<string | undefined> {
  const envPath = path.join(cwd, ".tomorrowedge", "local.env");
  let existing = "";
  try {
    existing = await readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log("warn", `Failed to remove local cockpit env key ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  }
  let removed: string | undefined;
  const lines = existing.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return Boolean(trimmed);
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (match?.[1] !== key) return true;
    removed = unquoteLocalEnvValue(match[2] ?? "");
    return false;
  });
  await writeFile(envPath, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
  return removed;
}

function readLocalEnvMap(cwd: string): Map<string, string> {
  const envPath = path.join(cwd, ".tomorrowedge", "local.env");
  try {
    const text = readFileSync(envPath, "utf8");
    const values = new Map<string, string>();
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match) continue;
      values.set(match[1]!, unquoteLocalEnvValue(match[2] ?? ""));
    }
    return values;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log("warn", `Failed to read local cockpit env file: ${error instanceof Error ? error.message : String(error)}`);
    }
    return new Map();
  }
}

function unquoteLocalEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function maskKey(value: string): string {
  if (value.length <= 8) return `${value.slice(0, 4)}****`;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function bindAllRoles(config: TomorrowEdgeConfig, provider: string, model: string): TomorrowEdgeConfig["agents"] {
  return Object.fromEntries(Object.keys(config.agents).map((role) => [role, { provider, model, reason: "Configured from first-run GUI setup" }]));
}
