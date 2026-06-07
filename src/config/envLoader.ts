import { existsSync, readFileSync } from "node:fs";
import { createDecipheriv, scryptSync } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
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

const SECRETS_FILE = join(homedir(), ".tomorrowedge", "secrets.enc");
const SCRYPT_OPT = { N: 16384 as const, r: 8 as const, p: 1 as const, keylen: 32 };

function deriveSecretKey(): Buffer {
  const salt = `tomorrowedge:${join(homedir(), ".tomorrowedge")}:${homedir()}`;
  return scryptSync(salt, salt, SCRYPT_OPT.keylen, SCRYPT_OPT);
}

function loadSecretsIntoEnv(): void {
  if (!existsSync(SECRETS_FILE)) return;
  try {
    const raw = readFileSync(SECRETS_FILE, "utf8").trim();
    if (!raw) return;
    const col = raw.indexOf(":");
    if (col <= 0) return;
    const iv = Buffer.from(raw.slice(0, col), "hex");
    const data = Buffer.from(raw.slice(col + 1), "hex");
    const key = deriveSecretKey();
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    const payload = JSON.parse(decrypted) as Record<string, string>;

    for (const [provider, value] of Object.entries(payload)) {
      if (!value) continue;
      const envName = `${provider.toUpperCase()}_API_KEY`;
      if (process.env[envName] !== undefined) continue; // shell/env 优先
      process.env[envName] = value;
    }
  } catch {
    // 加密文件损坏或格式错误时静默跳过
  }
}
