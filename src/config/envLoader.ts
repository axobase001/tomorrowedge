import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadLocalEnv(cwd: string): void {
  for (const envPath of [path.join(cwd, ".env"), path.join(cwd, ".tomorrowedge", "local.env")]) {
    loadEnvFile(envPath);
  }
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
