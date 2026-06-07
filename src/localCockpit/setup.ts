import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, writeConfig } from "../config/configLoader.js";
import type { ProviderConfig, TomorrowEdgeConfig } from "../config/schema.js";
import { testProviderConnection, type ProviderConnectionResult } from "../providers/connectionTest.js";

export type CockpitProviderReadiness = {
  id: string;
  enabled: boolean;
  model: string;
  baseUrl: string;
  apiKeyEnv?: string;
  keyConfigured: boolean;
  keySource: "env" | "local_env" | "not_required" | "missing";
  authRequired: boolean;
};

export type CockpitSetupStatus = {
  needsSetup: boolean;
  recommendedProvider: string;
  configPath: string;
  providers: CockpitProviderReadiness[];
  selectedProvider?: string;
  selectedModel?: string;
};

export type CockpitSetupRequest = {
  provider: string;
  model: string;
  apiKeyEnv?: string;
  apiKey?: string;
  bindRoles?: boolean;
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
  const providers = Object.entries(config.providers).map(([id, provider]) => providerReadiness(id, provider));
  const configuredLive = providers.find((provider) => provider.enabled && provider.authRequired && provider.keyConfigured && provider.model);
  const selected = configuredLive ?? providers.find((provider) => provider.enabled && provider.model);
  return {
    needsSetup: !configuredLive,
    recommendedProvider: config.model_discovery.recommended_provider,
    configPath: path.join(cwd, ".tomorrowedge", "config.yaml"),
    providers,
    selectedProvider: selected?.id,
    selectedModel: selected?.model
  };
}

export async function configureCockpitProvider(cwd: string, request: CockpitSetupRequest): Promise<CockpitSetupStatus> {
  const config = loadConfig(cwd);
  const providerId = normalizeProviderId(request.provider);
  if (!config.providers[providerId]) throw new Error(`Unknown provider: ${providerId}`);
  const model = request.model.trim();
  if (!model) throw new Error("At least one model id is required.");
  const apiKeyEnv = sanitizeEnvName(request.apiKeyEnv) ?? config.providers[providerId].api_key_env ?? defaultEnvNames[providerId];
  if (requiresAuth(config.providers[providerId]) && !apiKeyEnv) throw new Error("API key env var name is required for this provider.");
  if (request.apiKey?.trim() && apiKeyEnv) {
    await writeLocalEnvValue(cwd, apiKeyEnv, request.apiKey.trim());
    process.env[apiKeyEnv] = request.apiKey.trim();
  }
  const nextProvider: ProviderConfig = {
    ...config.providers[providerId],
    enabled: true,
    model,
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

export async function testCockpitProvider(cwd: string, providerId: string): Promise<ProviderConnectionResult> {
  const config = loadConfig(cwd);
  const normalized = normalizeProviderId(providerId);
  const provider = config.providers[normalized];
  if (!provider) throw new Error(`Unknown provider: ${normalized}`);
  return testProviderConnection(normalized, provider);
}

function providerReadiness(id: string, provider: ProviderConfig): CockpitProviderReadiness {
  const authRequired = requiresAuth(provider);
  const envName = provider.api_key_env;
  const envValue = envName ? process.env[envName] : undefined;
  return {
    id,
    enabled: provider.enabled,
    model: provider.model,
    baseUrl: provider.base_url,
    apiKeyEnv: envName,
    keyConfigured: !authRequired || Boolean(envValue),
    keySource: !authRequired ? "not_required" : envValue ? "env" : "missing",
    authRequired
  };
}

function requiresAuth(provider: ProviderConfig): boolean {
  return provider.auth_header !== "none";
}

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

function sanitizeEnvName(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^[A-Z_][A-Z0-9_]*$/.test(trimmed)) throw new Error("Env var name must use uppercase letters, numbers, and underscores.");
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

function bindAllRoles(config: TomorrowEdgeConfig, provider: string, model: string): TomorrowEdgeConfig["agents"] {
  return Object.fromEntries(Object.keys(config.agents).map((role) => [role, { provider, model, reason: "Configured from first-run GUI setup" }]));
}
