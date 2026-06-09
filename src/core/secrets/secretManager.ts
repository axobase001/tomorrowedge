import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { log } from "../../utils/logger.js";

export type ProviderSecretRecord = {
  provider: string;
  apiKey: string;
  apiKeyEnv?: string;
  updatedAt: string;
};

export type ProviderSecretMap = Map<string, ProviderSecretRecord>;

type PlainSecretStore = {
  providers: Record<string, ProviderSecretRecord>;
};

type EncryptedSecretFile = {
  version: 1;
  backend: "encrypted_file";
  cipher: "aes-256-gcm";
  kdf: "scrypt";
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
};

const serviceName = "tomorrowedge-provider-secrets";
const cipherName = "aes-256-gcm";

export function secretStorePath(cwd: string): string {
  const configured = process.env.TOMORROWEDGE_SECRET_STORE_PATH?.trim();
  if (configured) return path.resolve(configured);
  return path.join(cwd, ".tomorrowedge", "secrets.enc");
}

export function readProviderSecrets(cwd: string): ProviderSecretMap {
  const filePath = secretStorePath(cwd);
  if (!existsSync(filePath)) return new Map();
  try {
    const encrypted = JSON.parse(readFileSync(filePath, "utf8")) as EncryptedSecretFile;
    const plain = decryptStore(cwd, encrypted);
    return new Map(Object.entries(plain.providers ?? {}).map(([provider, record]) => [provider, {
      ...record,
      provider
    }]));
  } catch (error) {
    log("warn", `Encrypted provider secrets could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return new Map();
  }
}

export function getProviderSecret(cwd: string, provider: string): ProviderSecretRecord | undefined {
  return readProviderSecrets(cwd).get(normalizeProviderId(provider));
}

export async function saveProviderSecret(cwd: string, provider: string, apiKey: string, apiKeyEnv?: string): Promise<ProviderSecretRecord> {
  const providerId = normalizeProviderId(provider);
  const trimmedKey = apiKey.trim();
  if (!providerId) throw new Error("Provider id is required.");
  if (!trimmedKey) throw new Error("API key is required.");
  const current = readProviderSecrets(cwd);
  const record: ProviderSecretRecord = {
    provider: providerId,
    apiKey: trimmedKey,
    apiKeyEnv,
    updatedAt: new Date().toISOString()
  };
  current.set(providerId, record);
  await writeSecretStore(cwd, current);
  return record;
}

export async function deleteProviderSecret(cwd: string, provider: string): Promise<ProviderSecretRecord | undefined> {
  const providerId = normalizeProviderId(provider);
  const current = readProviderSecrets(cwd);
  const previous = current.get(providerId);
  if (!previous) return undefined;
  current.delete(providerId);
  if (!current.size) {
    await rm(secretStorePath(cwd), { force: true });
    return previous;
  }
  await writeSecretStore(cwd, current);
  return previous;
}

export function loadEncryptedSecretsIntoEnv(cwd: string): void {
  const secrets = readProviderSecrets(cwd);
  for (const [provider, record] of secrets) {
    const envName = record.apiKeyEnv || defaultEnvNameFor(provider);
    if (!envName || process.env[envName] !== undefined) continue;
    process.env[envName] = record.apiKey;
  }
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return `${value.slice(0, 4)}****`;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

async function writeSecretStore(cwd: string, records: ProviderSecretMap): Promise<void> {
  const filePath = secretStorePath(cwd);
  await mkdir(path.dirname(filePath), { recursive: true });
  const plain: PlainSecretStore = {
    providers: Object.fromEntries(Array.from(records.entries()).map(([provider, record]) => [provider, {
      ...record,
      provider
    }]))
  };
  await writeFile(filePath, `${JSON.stringify(encryptStore(cwd, plain), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function encryptStore(cwd: string, plain: PlainSecretStore): EncryptedSecretFile {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveEncryptionKey(cwd, salt);
  const cipher = createCipheriv(cipherName, key, iv);
  const plaintext = Buffer.from(JSON.stringify(plain), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    backend: "encrypted_file",
    cipher: cipherName,
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decryptStore(cwd: string, encrypted: EncryptedSecretFile): PlainSecretStore {
  if (encrypted.version !== 1 || encrypted.backend !== "encrypted_file" || encrypted.cipher !== cipherName || encrypted.kdf !== "scrypt") {
    throw new Error("unsupported encrypted secret store format");
  }
  const salt = Buffer.from(encrypted.salt, "base64");
  const iv = Buffer.from(encrypted.iv, "base64");
  const authTag = Buffer.from(encrypted.authTag, "base64");
  const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
  const key = deriveEncryptionKey(cwd, salt);
  const decipher = createDecipheriv(cipherName, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plaintext) as PlainSecretStore;
  return {
    providers: parsed.providers ?? {}
  };
}

function deriveEncryptionKey(cwd: string, salt: Buffer): Buffer {
  const explicitPassphrase = process.env.TOMORROWEDGE_SECRET_PASSPHRASE?.trim();
  const material = explicitPassphrase || JSON.stringify({
    service: serviceName,
    cwd: path.resolve(cwd),
    home: os.homedir(),
    user: safeUserName(),
    host: os.hostname(),
    platform: os.platform()
  });
  return scryptSync(material, salt, 32, { N: 16_384, r: 8, p: 1 });
}

function safeUserName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "unknown";
  }
}

function defaultEnvNameFor(providerId: string): string {
  const known: Record<string, string> = {
    openrouter: "OPENROUTER_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    kimi: "KIMI_API_KEY",
    mimo: "MIMO_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
    openai_compatible: "OPENAI_API_KEY"
  };
  if (known[providerId]) return known[providerId];
  const prefix = providerId.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return /^[A-Z_]/.test(prefix) ? `${prefix}_API_KEY` : `PROVIDER_${prefix}_API_KEY`;
}

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
}
