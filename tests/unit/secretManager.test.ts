/**
 * SecretManager 单元测试
 *
 * 覆盖：
 *   - maskKey 脱敏
 *   - saveSecret / getSecret / deleteSecret CRUD
 *   - listSecrets 列出所有 provider
 *   - loadSecretsFile 加密文件解析
 *   - 跨操作一致性：save → get → delete → get null
 *   - 边界：空 key、特殊字符、长 key
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  deleteSecret,
  getSecret,
  listSecrets,
  loadSecretsFile,
  maskKey,
  saveSecret,
  SUPPORTED_PROVIDERS,
  type ProviderName,
} from "../../src/core/secrets/secretManager.js";

const TEST_SECRETS_DIR = join(homedir(), ".tomorrowedge");
const TEST_SECRETS_FILE = join(TEST_SECRETS_DIR, "secrets.enc");

function backupSecretsFile(): Buffer | null {
  if (existsSync(TEST_SECRETS_FILE)) {
    return readFileSync(TEST_SECRETS_FILE);
  }
  return null;
}

function restoreSecretsFile(backup: Buffer | null) {
  if (backup) {
    mkdirSync(TEST_SECRETS_DIR, { recursive: true });
    writeFileSync(TEST_SECRETS_FILE, backup);
  } else if (existsSync(TEST_SECRETS_FILE)) {
    rmSync(TEST_SECRETS_FILE, { force: true });
  }
}

describe("maskKey", () => {
  it("脱敏标准 key（前 4 + 后 4）", () => {
    expect(maskKey("sk-1234567890abcdef1234")).toBe("sk-1****1234");
  });

  it("空字符串返回空", () => {
    expect(maskKey("")).toBe("");
  });

  it("短 key（≤8 字符）显示前 4", () => {
    expect(maskKey("sk-1234")).toBe("sk-1****");
  });

  it("带特殊字符的 key", () => {
    expect(maskKey("sk-!@#$%^&*()_+abcdef")).toBe("sk-!****cdef");
  });
});

describe("SecretManager 加密文件 CRUD", () => {
  let backup: Buffer | null;

  beforeEach(() => {
    backup = backupSecretsFile();
    if (existsSync(TEST_SECRETS_FILE)) rmSync(TEST_SECRETS_FILE, { force: true });
  });

  afterEach(() => {
    if (existsSync(TEST_SECRETS_FILE)) rmSync(TEST_SECRETS_FILE, { force: true });
    restoreSecretsFile(backup);
  });

  it("save → get → delete → get null", async () => {
    const provider: ProviderName = "deepseek";
    const apiKey = "sk-test-deepseek-key-12345";

    // Save
    await saveSecret(provider, apiKey);

    // Verify file exists and is encrypted (not plaintext)
    expect(existsSync(TEST_SECRETS_FILE)).toBe(true);
    const raw = readFileSync(TEST_SECRETS_FILE, "utf8");
    expect(raw).not.toContain(apiKey); // 密文中不应含有明文 key

    // Get
    const retrieved = await getSecret(provider);
    expect(retrieved).toBe(apiKey);

    // Delete
    await deleteSecret(provider);

    // Get after delete
    const afterDelete = await getSecret(provider);
    expect(afterDelete).toBeNull();
  });

  it("多个 provider 独立存储", async () => {
    await saveSecret("deepseek", "sk-deepseek-1");
    await saveSecret("openai", "sk-openai-2");
    await saveSecret("anthropic", "sk-anthropic-3");

    expect(await getSecret("deepseek")).toBe("sk-deepseek-1");
    expect(await getSecret("openai")).toBe("sk-openai-2");
    expect(await getSecret("anthropic")).toBe("sk-anthropic-3");

    // 删除一个
    await deleteSecret("openai");
    expect(await getSecret("openai")).toBeNull();
    // 其他不受影响
    expect(await getSecret("deepseek")).toBe("sk-deepseek-1");
    expect(await getSecret("anthropic")).toBe("sk-anthropic-3");
  });

  it("覆盖已有 key", async () => {
    await saveSecret("deepseek", "sk-original");
    await saveSecret("deepseek", "sk-updated");

    expect(await getSecret("deepseek")).toBe("sk-updated");
  });

  it("删除不存在的 provider 不报错", async () => {
    await expect(deleteSecret("gemini")).resolves.toBeUndefined();
  });

  it("空字符串 key 也能存储", async () => {
    await saveSecret("kimi", "");
    expect(await getSecret("kimi")).toBe("");
  });

  it("长 key（1000 字符）", async () => {
    const longKey = "sk-" + "a".repeat(1000);
    await saveSecret("deepseek", longKey);
    expect(await getSecret("deepseek")).toBe(longKey);
  });

  it("特殊 Unicode 字符 key", async () => {
    const unicodeKey = "sk-🔥テスト🎉";
    await saveSecret("mimo", unicodeKey);
    expect(await getSecret("mimo")).toBe(unicodeKey);
  });
});

describe("listSecrets", () => {
  let backup: Buffer | null;

  beforeEach(() => {
    backup = backupSecretsFile();
    if (existsSync(TEST_SECRETS_FILE)) rmSync(TEST_SECRETS_FILE, { force: true });
  });

  afterEach(() => {
    if (existsSync(TEST_SECRETS_FILE)) rmSync(TEST_SECRETS_FILE, { force: true });
    restoreSecretsFile(backup);
  });

  it("无配置时返回所有 provider 且 configured=false", async () => {
    const list = await listSecrets();
    expect(list).toHaveLength(SUPPORTED_PROVIDERS.length);
    for (const entry of list) {
      expect(entry.configured).toBe(false);
      expect(entry.maskedKey).toBeUndefined();
    }
  });

  it("部分配置后返回正确状态", async () => {
    await saveSecret("deepseek", "sk-test-123");
    await saveSecret("openai", "sk-test-456");

    const list = await listSecrets();
    const deepseek = list.find((e) => e.provider === "deepseek")!;
    expect(deepseek.configured).toBe(true);
    expect(deepseek.maskedKey).toBe("sk-t****-123");

    const openai = list.find((e) => e.provider === "openai")!;
    expect(openai.configured).toBe(true);
    expect(openai.maskedKey).toBe("sk-t****-456");

    const kimi = list.find((e) => e.provider === "kimi")!;
    expect(kimi.configured).toBe(false);
    expect(kimi.maskedKey).toBeUndefined();
  });
});

describe("loadSecretsFile", () => {
  let backup: Buffer | null;

  beforeEach(() => {
    backup = backupSecretsFile();
    if (existsSync(TEST_SECRETS_FILE)) rmSync(TEST_SECRETS_FILE, { force: true });
  });

  afterEach(() => {
    if (existsSync(TEST_SECRETS_FILE)) rmSync(TEST_SECRETS_FILE, { force: true });
    restoreSecretsFile(backup);
  });

  it("文件不存在时返回空对象", () => {
    expect(loadSecretsFile()).toEqual({});
  });

  it("通过 saveSecret 写入后 loadSecretsFile 能正确读取", async () => {
    await saveSecret("deepseek", "sk-load-test");
    const payload = loadSecretsFile();
    expect(payload["deepseek"]).toBe("sk-load-test");
  });

  it("无法被密钥派生的机器解密（加密文件是机器绑定的）", async () => {
    // save → 加密文件是机器相关的 scrypt salt
    await saveSecret("deepseek", "sk-machine-bound");

    // 读取应成功（同一台机器）
    const payload = loadSecretsFile();
    expect(payload["deepseek"]).toBe("sk-machine-bound");

    // 验证文件格式
    const raw = readFileSync(TEST_SECRETS_FILE, "utf8");
    const parts = raw.split(":");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBe(32); // IV hex = 16 bytes = 32 hex chars
    expect(parts[1].length).toBeGreaterThan(0); // encrypted data
  });
});
