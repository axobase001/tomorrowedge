import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteProviderSecret,
  loadEncryptedSecretsIntoEnv,
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
});

async function mkdtemp(prefix: string): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
