import { existsSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../config/configLoader.js";
import type { TomorrowEdgeConfig } from "../../config/schema.js";
import { loadProjectPreferences, type ProjectPreferences } from "../memory/preferences.js";
import { buildStrategyMemoryHints, type StrategyMemoryHints } from "../memory/taskMemory.js";
import type { AgentRole } from "../../schemas/agentTask.js";

export type RuntimeRunOptions = {
  provider?: string;
  fixtureMode?: boolean;
  forceFixtureWorkspace?: boolean;
};

export type RunWorkspace = {
  executionCwd: string;
  fixtureWorkspace?: string;
};

export type RuntimeConfigResolution = {
  loadedConfig: TomorrowEdgeConfig;
  prefs: ProjectPreferences;
  memoryHints?: StrategyMemoryHints;
  config: TomorrowEdgeConfig;
};

export async function resolveRuntimeConfig(cwd: string, options: { task?: string } = {}): Promise<RuntimeConfigResolution> {
  const loadedConfig = loadConfig(cwd);
  const prefs = loadProjectPreferences(cwd);
  const baseConfig: TomorrowEdgeConfig = {
    ...loadedConfig,
    routing: prefs.routingMode ? { ...loadedConfig.routing, mode: prefs.routingMode } : loadedConfig.routing,
    strategy_memory: prefs.strategyMemoryRouting === undefined
      ? loadedConfig.strategy_memory
      : { ...loadedConfig.strategy_memory, enabled: prefs.strategyMemoryRouting }
  };
  const enabledProviders = Object.entries(baseConfig.providers)
    .filter(([, provider]) => provider.enabled)
    .map(([providerId]) => providerId);
  const memoryHints = baseConfig.strategy_memory.enabled
    ? await buildStrategyMemoryHints(cwd, {
        limit: baseConfig.strategy_memory.max_records,
        task: options.task,
        enabledProviders
      })
    : undefined;
  const config = memoryHints ? applyStrategyMemory(baseConfig, memoryHints) : baseConfig;
  return { loadedConfig, prefs, memoryHints, config };
}

export async function prepareRunWorkspace(cwd: string, options: RuntimeRunOptions): Promise<RunWorkspace> {
  if (!isFixtureRun(options)) {
    return { executionCwd: cwd };
  }

  if (!options.forceFixtureWorkspace && existsSync(path.join(cwd, "index.js")) && existsSync(path.join(cwd, "package.json"))) {
    return { executionCwd: cwd };
  }

  const fixtureSource = path.join(cwd, "tests", "fixtures", "sample-repo-basic");
  if (!existsSync(path.join(fixtureSource, "index.js")) || !existsSync(path.join(fixtureSource, "package.json"))) {
    return { executionCwd: cwd };
  }

  const fixtureWorkspace = await mkdtemp(path.join(os.tmpdir(), "tedge-fixture-demo-"));
  await cp(fixtureSource, fixtureWorkspace, { recursive: true });
  return { executionCwd: fixtureWorkspace, fixtureWorkspace };
}

export function isFixtureRun(options: RuntimeRunOptions): boolean {
  return Boolean(options.fixtureMode || options.provider === "fixture");
}

export function liveOption(offline: boolean | undefined, live: boolean | undefined, autoLive: boolean, explicit: boolean | undefined): boolean {
  if (offline) return false;
  if (live) return true;
  if (explicit !== undefined) return explicit;
  return autoLive;
}

export function shouldAutoLive(config: TomorrowEdgeConfig, options: { offline?: boolean; live?: boolean; provider?: string; fixtureMode?: boolean }): boolean {
  if (options.offline || isFixtureRun(options)) return false;
  if (options.live) return true;
  return Object.entries(config.providers).some(([, provider]) => {
    if (!provider.enabled || !provider.base_url || provider.auth_header === "none") return false;
    return Boolean(provider.api_key_env && process.env[provider.api_key_env]);
  });
}

export function applyStrategyMemory(config: TomorrowEdgeConfig, hints: StrategyMemoryHints): TomorrowEdgeConfig {
  if (!config.strategy_memory.prefer_successful_routes || !hints.routeAssignments.length) return config;
  const agents = { ...config.agents };
  for (const route of hints.routeAssignments) {
    const current = agents[route.role as AgentRole];
    if (!current || (current.provider !== "auto" && current.model !== "auto")) continue;
    agents[route.role as AgentRole] = { provider: route.provider, model: route.model, reason: route.reason };
  }
  return { ...config, agents };
}
