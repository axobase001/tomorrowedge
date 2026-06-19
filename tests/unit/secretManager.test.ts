import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteProviderSecret,
  loadEncryptedSecretsIntoEnv,
  ProviderSecretStoreUnreadableError,
  readProviderSecrets,
  saveProviderSecret,
  secretStorePath
} from "../../src/core/secrets/secretManager.js";

describe("encrypted provider secret manager", () => {
  it("stores provider keys in an authenticated encrypted file", async () => {
    const cwd = await mkdtemp("tedge-secret-store-");
    const previousPassphrase = process.env.TOMORROWEDGE_SECRET_PASSPHRASE;
    const previousEnv = process.env.TEST_SECRET_OPENROUTER;
    process.env.TOMORROWEDGE_SECRET_PASSPHRASE = "test-secret-passphrase";
    delete process.env.TEST_SECRET_OPENROUTER;
    try {
      await saveProviderSecret(cwd, "openrouter", "test-secret-openrouter-key", "TEST_SECRET_OPENROUTER");
      const fileText = await readFile(secretStorePath(cwd), "utf8");
      const secrets = readProviderSecrets(cwd);

      expect(fileText).toContain("encrypted_file");
      expect(fileText).not.toContain("test-secret-openrouter-key");
      expect(secrets.get("openrouter")).toMatchObject({
        provider: "openrouter",
        apiKeyEnv: "TEST_SECRET_OPENROUTER",
        apiKey: "test-secret-openrouter-key"
      });

      loadEncryptedSecretsIntoEnv(cwd);
      expect(process.env.TEST_SECRET_OPENROUTER).toBe("test-secret-openrouter-key");

      const deleted = await deleteProviderSecret(cwd, "openrouter");
      expect(deleted?.apiKey).toBe("test-secret-openrouter-key");
      expect(readProviderSecrets(cwd).size).toBe(0);
    } finally {
      if (previousPassphrase === undefined) delete process.env.TOMORROWEDGE_SECRET_PASSPHRASE;
      else process.env.TOMORROWEDGE_SECRET_PASSPHRASE = previousPassphrase;
      if (previousEnv === undefined) delete process.env.TEST_SECRET_OPENROUTER;
      else process.env.TEST_SECRET_OPENROUTER = previousEnv;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fails closed instead of overwriting an encrypted store when the passphrase is wrong", async () => {
    const cwd = await mkdtemp("tedge-secret-store-wrong-passphrase-");
    const previousPassphrase = process.env.TOMORROWEDGE_SECRET_PASSPHRASE;
    try {
      process.env.TOMORROWEDGE_SECRET_PASSPHRASE = "pass-one";
      await saveProviderSecret(cwd, "openrouter", "test-secret-openrouter-key", "TEST_SECRET_OPENROUTER");
      const filePath = secretStorePath(cwd);
      const originalCiphertext = await readFile(filePath, "utf8");

      process.env.TOMORROWEDGE_SECRET_PASSPHRASE = "pass-two";
      expect(readProviderSecrets(cwd).size).toBe(0);
      await expect(saveProviderSecret(cwd, "deepseek", "test-secret-deepseek-key", "TEST_SECRET_DEEPSEEK")).rejects.toThrow(ProviderSecretStoreUnreadableError);
      expect(await readFile(filePath, "utf8")).toBe(originalCiphertext);

      process.env.TOMORROWEDGE_SECRET_PASSPHRASE = "pass-one";
      const recovered = readProviderSecrets(cwd);
      expect(recovered.get("openrouter")?.apiKey).toBe("test-secret-openrouter-key");
      expect(recovered.has("deepseek")).toBe(false);
    } finally {
      if (previousPassphrase === undefined) delete process.env.TOMORROWEDGE_SECRET_PASSPHRASE;
      else process.env.TOMORROWEDGE_SECRET_PASSPHRASE = previousPassphrase;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fails closed instead of overwriting a corrupted encrypted store", async () => {
    const cwd = await mkdtemp("tedge-secret-store-corrupted-");
    const previousPassphrase = process.env.TOMORROWEDGE_SECRET_PASSPHRASE;
    try {
      process.env.TOMORROWEDGE_SECRET_PASSPHRASE = "test-secret-passphrase";
      const filePath = secretStorePath(cwd);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, "{ not json", "utf8");

      expect(readProviderSecrets(cwd).size).toBe(0);
      await expect(saveProviderSecret(cwd, "openrouter", "test-secret-openrouter-key", "TEST_SECRET_OPENROUTER")).rejects.toThrow(ProviderSecretStoreUnreadableError);
      expect(await readFile(filePath, "utf8")).toBe("{ not json");
    } finally {
      if (previousPassphrase === undefined) delete process.env.TOMORROWEDGE_SECRET_PASSPHRASE;
      else process.env.TOMORROWEDGE_SECRET_PASSPHRASE = previousPassphrase;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("still saves provider keys on a first-run empty store", async () => {
    const cwd = await mkdtemp("tedge-secret-store-first-run-");
    const previousPassphrase = process.env.TOMORROWEDGE_SECRET_PASSPHRASE;
    try {
      process.env.TOMORROWEDGE_SECRET_PASSPHRASE = "test-secret-passphrase";
      expect(readProviderSecrets(cwd).size).toBe(0);

      await saveProviderSecret(cwd, "openrouter", "test-secret-openrouter-key", "TEST_SECRET_OPENROUTER");

      expect(readProviderSecrets(cwd).get("openrouter")?.apiKey).toBe("test-secret-openrouter-key");
    } finally {
      if (previousPassphrase === undefined) delete process.env.TOMORROWEDGE_SECRET_PASSPHRASE;
      else process.env.TOMORROWEDGE_SECRET_PASSPHRASE = previousPassphrase;
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function mkdtemp(prefix: string): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
