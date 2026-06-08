/**
 * Secret Manager — 安全 API Key 存储模块
 *
 * 策略：
 *   1. 优先使用操作系统原生 keychain（keytar）
 *   2. 失败时 fallback 到本地 AES-256-CBC 加密文件
 *
 * 安全设计参考 VS Code SecretStorage：
 *   - 禁止明文存储
 *   - 使用 scrypt 派生密钥
 *   - 每次加密使用随机 IV
 *   - 日志中脱敏输出
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export const SUPPORTED_PROVIDERS = [
  "deepseek",
  "openai",
  "anthropic",
  "openrouter",
  "gemini",
  "kimi",
  "mimo",
] as const;

export type ProviderName = (typeof SUPPORTED_PROVIDERS)[number];

export interface SecretEntry {
  provider: ProviderName;
  configured: boolean;
  /** 脱敏后的 key 片段，例如 "sk-1234****abcd" */
  maskedKey?: string;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const SERVICE_NAME = "tomorrowedge";
const SECRETS_DIR = join(homedir(), ".tomorrowedge");
const SECRETS_FILE = join(SECRETS_DIR, "secrets.enc");

/**
 * scrypt 派生参数
 * keylen 32 = AES-256-CBC
 */
const SCRYPT_KEYLEN = 32;
const SCRYPT_N = 16384; // CPU/memory cost
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const IV_LENGTH = 16; // AES block size

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 从固定 salt 派生加密密钥（生产环境应从安全随机源获取 salt） */
function deriveKey(): Buffer {
  // 使用服务名 + 机器相关路径作为 salt 来源
  const saltInput = `${SERVICE_NAME}:${SECRETS_DIR}:${homedir()}`;
  return scryptSync(saltInput, saltInput, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

/** 脱敏 API Key，保留前 4 和后 4 个字符 */
export function maskKey(key: string): string {
  if (!key || key.length <= 8) {
    return key ? `${key.slice(0, 4)}****` : "";
  }
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// 文件加密存储（fallback）
// ---------------------------------------------------------------------------

interface EncryptedFile {
  iv: string; // hex
  data: string; // hex
}

interface SecretsPayload {
  [provider: string]: string;
}

/** AES-256-CBC 加密 */
function encryptAes(plaintext: string, key: Buffer): EncryptedFile {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
  };
}

/** AES-256-CBC 解密 */
function decryptAes(ivHex: string, dataHex: string, key: Buffer): string {
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(dataHex, "hex");
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** 读取并解密所有 secrets。导出供 envLoader / setup 同步使用。 */
export function loadSecretsFile(): SecretsPayload {
  ensureSecretsDir();
  if (!existsSync(SECRETS_FILE)) {
    return {};
  }
  try {
    const raw = readFileSync(SECRETS_FILE, "utf8").trim();
    if (!raw) return {};
    const [ivHex, dataHex] = raw.split(":");
    if (!ivHex || !dataHex) return {};
    const key = deriveKey();
    const json = decryptAes(ivHex, dataHex, key);
    return JSON.parse(json) as SecretsPayload;
  } catch {
    console.warn("[SecretManager] 解密 secrets 文件失败，返回空配置。");
    return {};
  }
}

/** 加密并写入所有 secrets */
function saveSecretsFile(payload: SecretsPayload): void {
  ensureSecretsDir();
  const key = deriveKey();
  const json = JSON.stringify(payload);
  const { iv, data } = encryptAes(json, key);
  writeFileSync(SECRETS_FILE, `${iv}:${data}`, "utf8");
}

function ensureSecretsDir(): void {
  if (!existsSync(SECRETS_DIR)) {
    mkdirSync(SECRETS_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// keytar 适配器（可选）
// ---------------------------------------------------------------------------

/**
 * 尝试动态加载 keytar。
 * keytar 是可选依赖，如果未安装则返回 null。
 */
async function tryLoadKeytar(): Promise<KeytarLike | null> {
  try {
    // keytar 是可选原生依赖，运行时如果不存在则 fallback 到文件加密存储
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - optional native dependency
    const mod = await import("keytar");
    return {
      getPassword: (service: string, account: string) =>
        mod.getPassword(service, account),
      setPassword: (service: string, account: string, password: string) =>
        mod.setPassword(service, account, password),
      deletePassword: (service: string, account: string) =>
        mod.deletePassword(service, account),
    };
  } catch {
    console.warn(
      "[SecretManager] keytar 不可用，使用加密文件存储作为 fallback。"
    );
    return null;
  }
}

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// 核心 API
// ---------------------------------------------------------------------------

let keytarInstance: KeytarLike | null | undefined = undefined;

async function getKeytar(): Promise<KeytarLike | null> {
  if (keytarInstance === undefined) {
    keytarInstance = await tryLoadKeytar();
  }
  return keytarInstance;
}

/**
 * 保存 API Key。
 * 优先使用操作系统 keychain，失败则 fallback 到加密文件。
 */
export async function saveSecret(
  provider: ProviderName,
  value: string
): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(SERVICE_NAME, provider, value);
      return;
    } catch (error) {
      console.warn(
        `[SecretManager] keytar 保存失败（${provider}），fallback 到加密文件。`
      );
    }
  }

  // Fallback: 文件加密存储
  const payload = loadSecretsFile();
  payload[provider] = value;
  saveSecretsFile(payload);
}

/**
 * 读取 API Key。
 * 优先从操作系统 keychain 读取，失败则 fallback 到加密文件。
 */
export async function getSecret(
  provider: ProviderName
): Promise<string | null> {
  const keytar = await getKeytar();
  if (keytar) {
    try {
      const value = await keytar.getPassword(SERVICE_NAME, provider);
      if (value !== null) return value;
      // keytar 中未找到，尝试文件存储
    } catch (error) {
      console.warn(
        `[SecretManager] keytar 读取失败（${provider}），fallback 到加密文件。`
      );
    }
  }

  // Fallback: 文件存储
  const payload = loadSecretsFile();
  return payload[provider] ?? null;
}

/**
 * 删除 API Key。
 */
export async function deleteSecret(
  provider: ProviderName
): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(SERVICE_NAME, provider);
    } catch (error) {
      console.warn(
        `[SecretManager] keytar 删除失败（${provider}），从加密文件中移除。`
      );
    }
  }

  // Fallback: 文件存储
  const payload = loadSecretsFile();
  delete payload[provider];
  saveSecretsFile(payload);
}

/**
 * 列出所有已配置的 provider 状态。
 * 不返回原始 key，只返回是否已配置和脱敏后的 key。
 */
export async function listSecrets(): Promise<SecretEntry[]> {
  const results: SecretEntry[] = [];

  for (const provider of SUPPORTED_PROVIDERS) {
    // 同时检查 keytar 和文件存储
    const keytar = await getKeytar();
    let secret: string | null = null;

    if (keytar) {
      try {
        secret = await keytar.getPassword(SERVICE_NAME, provider);
      } catch {
        // 忽略错误，继续检查文件
      }
    }

    if (!secret) {
      const payload = loadSecretsFile();
      secret = payload[provider] ?? null;
    }

    results.push({
      provider,
      configured: secret !== null && secret.length > 0,
      maskedKey: secret ? maskKey(secret) : undefined,
    });
  }

  return results;
}
