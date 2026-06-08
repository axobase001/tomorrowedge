import { existsSync, readFileSync } from "node:fs";
import { loadSecretsFile } from "../core/secrets/secretManager.js";
import path from "node:path";

export function loadLocalEnv(cwd: string): void {
  for (const envPath of [path.join(cwd, ".env"), path.join(cwd, ".tomorrowedge", "local.env")]) {
    loadEnvFile(envPath);
  }
  // 从加密存储加载 API Key，注入 process.env 供 provider 层使用
  loadSecretsIntoEnv();
}

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (process.env[key] !== undefined) {
      const envValue = unquoteEnvValue(rawValue);
      if (process.env[key] !== envValue) {
        console.warn(`[tomorrowedge] ${key} is already set in the shell environment. Using environment value (${key}=${process.env[key]}), ignoring .env value (${key}=${envValue}).`);
      }
      continue;
    }
    process.env[key] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// ---------------------------------------------------------------------------
// 从 SecretManager 同步加载 API Key 到 process.env
// ---------------------------------------------------------------------------

function loadSecretsIntoEnv(): void {
  const payload = loadSecretsFile(); // 复用 secretManager 的解密逻辑
  for (const [provider, value] of Object.entries(payload)) {
    if (!value) continue;
    const envName = `${provider.toUpperCase()}_API_KEY`;
    if (process.env[envName] !== undefined) continue; // shell/env 优先
    process.env[envName] = value;
  }
}
