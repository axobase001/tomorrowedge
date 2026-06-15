import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, writeConfig } from "../config/configLoader.js";
import type { ProviderConfig, TomorrowEdgeConfig } from "../config/schema.js";
import { deleteProviderSecret, getProviderSecret, maskSecret, readProviderSecrets, saveProviderSecret, type ProviderSecretMap } from "../core/secrets/secretManager.js";
import { testProviderConnection, type ProviderConnectionResult } from "../providers/connectionTest.js";
import { fetchProviderModelCatalog } from "../providers/modelCatalog.js";
import { assertProviderModelCompatible } from "../providers/modelCompatibility.js";
import { canonicalizeOpenRouterModelId, fetchOpenRouterCatalog, recommendFreeOpenRouterModels } from "../providers/openrouterCatalog.js";
import { staticModelsForProvider } from "../providers/staticModels.js";
import { log } from "../utils/logger.js";

export type CockpitProviderReadiness = {
  id: string;
  enabled: boolean;
  model: string;
  models: CockpitProviderModelOption[];
  baseUrl: string;
  apiKeyEnv?: string;
  keyConfigured: boolean;
  keySource: "env" | "local_env" | "encrypted_file" | "not_required" | "missing";
  maskedKey?: string;
  authRequired: boolean;
  requestTimeoutMs: number;
  maxRetries: number;
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
  requestTimeoutMs?: number;
  maxRetries?: number;
};

export type CockpitProviderKeyRequest = {
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  requestTimeoutMs?: number;
  maxRetries?: number;
};

export type CockpitProviderModelOption = {
  id: string;
  label: string;
  source: "catalog" | "static" | "config";
  isFree?: boolean;
  isLowCost?: boolean;
  tags?: string[];
  cached?: boolean;
  stale?: boolean;
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

type ModelCatalogCacheEntry = {
  expiresAt: number;
  fetchedAt: number;
  models: CockpitProviderModelOption[];
  inFlight?: Promise<CockpitProviderModelOption[]>;
};

const providerModelCatalogCache = new Map<string, ModelCatalogCacheEntry>();

export function getCockpitSetupStatus(cwd: string): CockpitSetupStatus {
  const config = loadConfig(cwd);
  const localEnv = readLocalEnvMap(cwd);
  const encryptedSecrets = readProviderSecrets(cwd);
  const providers = Object.entries(config.providers).map(([id, provider]) => providerReadiness(id, provider, localEnv, encryptedSecrets));
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
  const model = canonicalModelForProvider(providerId, request.model);
  if (!model) throw new Error("At least one model id is required.");
  const baseUrl = sanitizeBaseUrl(request.baseUrl) ?? currentProvider.base_url;
  if (!baseUrl) throw new Error("Base URL is required for this provider.");
  assertProviderModelCompatible(providerId, model, { ...currentProvider, base_url: baseUrl });
  const apiKeyEnv = sanitizeEnvName(request.apiKeyEnv) ?? currentProvider.api_key_env ?? defaultEnvNameFor(providerId);
  if (requiresAuth(currentProvider) && !apiKeyEnv) throw new Error("API key env var name is required for this provider.");
  if (request.apiKey?.trim() && apiKeyEnv) {
    await saveProviderSecret(cwd, providerId, request.apiKey.trim(), apiKeyEnv);
    process.env[apiKeyEnv] = request.apiKey.trim();
  }
  const nextProvider: ProviderConfig = {
    ...currentProvider,
    enabled: true,
    model,
    models: mergeProviderModels(currentProvider.models, [{ id: model, label: model }]),
    base_url: baseUrl,
    api_key_env: apiKeyEnv,
    requestTimeoutMs: sanitizePositiveInt(request.requestTimeoutMs) ?? currentProvider.requestTimeoutMs ?? 60_000,
    maxRetries: sanitizeNonNegativeInt(request.maxRetries) ?? currentProvider.maxRetries ?? 1
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
  const apiKey = request.apiKey?.trim() ?? "";
  const apiKeyEnv = sanitizeEnvName(request.apiKeyEnv) ?? currentProvider.api_key_env ?? defaultEnvNameFor(providerId);
  if (!apiKeyEnv) throw new Error("API key env var name is required for this provider.");
  const model = canonicalModelForProvider(providerId, request.model ?? currentProvider.model);
  if (!model) throw new Error("At least one model id is required.");
  const baseUrl = sanitizeBaseUrl(request.baseUrl) ?? currentProvider.base_url;
  if (!baseUrl) throw new Error("Base URL is required for this provider.");
  assertProviderModelCompatible(providerId, model, { ...currentProvider, base_url: baseUrl });
  if (apiKey) {
    await saveProviderSecret(cwd, providerId, apiKey, apiKeyEnv);
    process.env[apiKeyEnv] = apiKey;
  } else if (requiresAuth(currentProvider)) {
    const localEnv = readLocalEnvMap(cwd);
    const existingKey = process.env[apiKeyEnv] ?? localEnv.get(apiKeyEnv) ?? getProviderSecret(cwd, providerId)?.apiKey;
    if (!existingKey) throw new Error("API key is required unless an existing key is configured for this env var.");
  }
  await writeConfig(cwd, {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: {
        ...currentProvider,
        enabled: true,
        model,
        models: mergeProviderModels(currentProvider.models, [{ id: model, label: model }]),
        base_url: baseUrl,
        api_key_env: apiKeyEnv,
        requestTimeoutMs: sanitizePositiveInt(request.requestTimeoutMs) ?? currentProvider.requestTimeoutMs ?? 60_000,
        maxRetries: sanitizeNonNegativeInt(request.maxRetries) ?? currentProvider.maxRetries ?? 1
      }
    }
  });
  return getCockpitSetupStatus(cwd);
}

export async function listCockpitProviderModels(cwd: string, providerIdValue: string, limit = 20): Promise<CockpitProviderModelOption[]> {
  const config = loadConfig(cwd);
  const providerId = normalizeProviderId(providerIdValue);
  const provider = providerConfigForSetup(config, providerId);
  const localEnv = readLocalEnvMap(cwd);
  const apiKey = provider.api_key_env ? process.env[provider.api_key_env] ?? localEnv.get(provider.api_key_env) : undefined;
  const normalizedLimit = Math.max(1, Math.min(limit, 50));
  const cacheKey = providerModelCatalogCacheKey(cwd, providerId, provider, normalizedLimit);
  const cached = providerModelCatalogCache.get(cacheKey);
  const now = Date.now();
  if (cached?.models.length && cached.expiresAt > now) {
    return cloneModelOptions(cached.models, { cached: true });
  }
  if (cached?.inFlight) {
    return cloneModelOptions(await cached.inFlight, { cached: true });
  }
  const inFlight = fetchCockpitProviderCatalog(providerId, provider, apiKey, normalizedLimit);
  providerModelCatalogCache.set(cacheKey, {
    models: cached?.models ?? [],
    fetchedAt: cached?.fetchedAt ?? 0,
    expiresAt: cached?.expiresAt ?? 0,
    inFlight
  });
  try {
    const models = await inFlight;
    if (models.length) {
      providerModelCatalogCache.set(cacheKey, {
        models,
        fetchedAt: now,
        expiresAt: now + modelCatalogCacheTtlMs()
      });
      return models;
    }
  } catch (error) {
    if (cached?.models.length) {
      log("warn", `Reusing stale ${providerId} model catalog after refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      return cloneModelOptions(cached.models, { cached: true, stale: true });
    }
    log("warn", `Falling back to static ${providerId} models: ${error instanceof Error ? error.message : String(error)}`);
  }
  providerModelCatalogCache.delete(cacheKey);
  return staticModelOptionsFor(providerId);
}

export function clearCockpitProviderModelCache(): void {
  providerModelCatalogCache.clear();
}

async function fetchCockpitProviderCatalog(providerId: string, provider: ProviderConfig, apiKey: string | undefined, limit: number): Promise<CockpitProviderModelOption[]> {
  if (providerId !== "openrouter") {
    const catalog = await fetchProviderModelCatalog(providerId, provider, apiKey);
    return catalog.slice(0, limit).map((model) => ({
      id: model.id,
      label: model.label ?? model.id,
      source: "catalog" as const,
      tags: model.tags
    }));
  }
  const catalog = await fetchOpenRouterCatalog(provider, apiKey);
  return recommendFreeOpenRouterModels(catalog, { limit, preferKimi: true }).map((model) => ({
    id: model.id,
    label: `${model.name ?? model.id}${model.isFree ? " (free)" : model.isLowCost ? " (low cost)" : ""}`,
    source: "catalog",
    isFree: model.isFree,
    isLowCost: model.isLowCost,
    tags: model.tags
  }));
}

function providerModelCatalogCacheKey(cwd: string, providerId: string, provider: ProviderConfig, limit: number): string {
  return [
    path.resolve(cwd),
    providerId,
    provider.base_url.replace(/\/+$/, ""),
    provider.api_key_env ?? "",
    provider.auth_header,
    provider.api_format,
    String(limit)
  ].join("|");
}

function modelCatalogCacheTtlMs(): number {
  const parsed = Number(process.env.TOMORROWEDGE_COCKPIT_MODEL_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 120_000;
}

function cloneModelOptions(models: CockpitProviderModelOption[], patch: Pick<CockpitProviderModelOption, "cached" | "stale">): CockpitProviderModelOption[] {
  return models.map((model) => ({
    ...model,
    cached: patch.cached,
    stale: patch.stale
  }));
}

function staticModelOptionsFor(providerId: string): CockpitProviderModelOption[] {
  const options = staticModelsForProvider(providerId);
  return options.map((model) => ({
    id: model.id,
    label: model.label ?? model.id,
    source: "static",
    isFree: model.isFree ?? model.id.includes(":free"),
    isLowCost: model.isLowCost,
    tags: model.tags
  }));
}

export async function deleteCockpitProviderKey(cwd: string, providerIdValue: string): Promise<CockpitSetupStatus> {
  const config = loadConfig(cwd);
  const providerId = normalizeProviderId(providerIdValue);
  const provider = config.providers[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  const apiKeyEnv = provider.api_key_env ?? defaultEnvNameFor(providerId);
  const removedCredential = await deleteProviderSecret(cwd, providerId);
  if (apiKeyEnv) {
    const previous = await removeLocalEnvValue(cwd, apiKeyEnv);
    if (
      (previous !== undefined && process.env[apiKeyEnv] === previous) ||
      (removedCredential?.apiKey && process.env[apiKeyEnv] === removedCredential.apiKey)
    ) {
      delete process.env[apiKeyEnv];
    }
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
    const model = canonicalModelForProvider(provider, assignment.model);
    if (!provider || !model) throw new Error(`Role ${assignment.role} requires provider and model.`);
    if (provider.startsWith("external:") && !config.external_agents[provider.slice("external:".length)]) {
      throw new Error(`Role ${assignment.role} references unknown external agent: ${provider}`);
    }
    if (provider !== "auto" && !provider.startsWith("external:") && !config.providers[provider]) {
      throw new Error(`Role ${assignment.role} references unknown provider: ${provider}`);
    }
    if (provider !== "auto" && !provider.startsWith("external:")) {
      assertProviderModelCompatible(provider, model, config.providers[provider]);
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

function providerReadiness(id: string, provider: ProviderConfig, localEnv: Map<string, string>, encryptedSecrets: ProviderSecretMap): CockpitProviderReadiness {
  const authRequired = requiresAuth(provider);
  const envName = provider.api_key_env;
  const envValue = envName ? process.env[envName] : undefined;
  const localValue = envName ? localEnv.get(envName) : undefined;
  const encryptedValue = encryptedSecrets.get(id)?.apiKey;
  const keyValue = envValue ?? localValue ?? encryptedValue;
  const keySource = !authRequired
    ? "not_required"
    : localValue && (!envValue || envValue === localValue)
      ? "local_env"
      : encryptedValue && (!envValue || envValue === encryptedValue)
        ? "encrypted_file"
        : envValue
          ? "env"
          : localValue
            ? "local_env"
            : encryptedValue
              ? "encrypted_file"
              : "missing";
  return {
    id,
    enabled: provider.enabled,
    model: provider.model,
    models: providerModelOptionsFromConfig(provider),
    baseUrl: provider.base_url,
    apiKeyEnv: envName,
    keyConfigured: !authRequired || Boolean(keyValue),
    keySource,
    maskedKey: keyValue ? maskSecret(keyValue) : undefined,
    authRequired,
    requestTimeoutMs: provider.requestTimeoutMs ?? 60_000,
    maxRetries: provider.maxRetries ?? 1
  };
}

function providerModelOptionsFromConfig(provider: ProviderConfig): CockpitProviderModelOption[] {
  return mergeProviderModels(provider.models, provider.model ? [{ id: provider.model, label: provider.model }] : [])
    .map((model) => ({
      id: model.id,
      label: model.label ?? model.id,
      source: "config" as const,
      isFree: model.id.includes(":free")
    }));
}

function mergeProviderModels(
  current: Array<{ id: string; label?: string }> | undefined,
  next: Array<{ id: string; label?: string }>
): Array<{ id: string; label?: string }> {
  const byId = new Map<string, { id: string; label?: string }>();
  for (const model of [...(current ?? []), ...next]) {
    const id = model.id.trim();
    if (!id) continue;
    const existing = byId.get(id);
    byId.set(id, {
      id,
      label: model.label?.trim() || existing?.label
    });
  }
  return Array.from(byId.values());
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
    models: [],
    api_format: "openai_chat",
    auth_header: "bearer",
    extra_headers: {},
    requestTimeoutMs: 60_000,
    maxRetries: 1,
    retryBaseDelayMs: 1000
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

function canonicalModelForProvider(providerId: string, value: string): string {
  const trimmed = value.trim();
  if (providerId === "openrouter") return canonicalizeOpenRouterModelId(trimmed);
  return trimmed;
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

function sanitizePositiveInt(value?: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0) throw new Error("Request timeout must be a positive integer in milliseconds.");
  return value;
}

function sanitizeNonNegativeInt(value?: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) throw new Error("Max retries must be a non-negative integer.");
  return value;
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

function bindAllRoles(config: TomorrowEdgeConfig, provider: string, model: string): TomorrowEdgeConfig["agents"] {
  return Object.fromEntries(Object.keys(config.agents).map((role) => [role, { provider, model, reason: "Configured from first-run GUI setup" }]));
}
