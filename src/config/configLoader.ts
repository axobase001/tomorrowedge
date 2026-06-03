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
  return configSchema.parse(deepMerge(defaultConfig, parsed));
}

export async function writeDefaultConfig(cwd: string): Promise<string> {
  const dir = path.join(cwd, configDirName);
  await mkdir(dir, { recursive: true });
  const configPath = getConfigPath(cwd);
  await writeFile(configPath, YAML.stringify(defaultConfig), "utf8");
  return configPath;
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
