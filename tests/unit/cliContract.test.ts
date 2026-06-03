import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version: string };

describe("CLI contract", () => {
  it("prints the package version", async () => {
    const result = await execa("tsx", ["src/cli/index.ts", "--version"], {
      cwd: process.cwd(),
      preferLocal: true
    });

    expect(result.stdout.trim()).toBe(packageJson.version);
  }, 15_000);
});
