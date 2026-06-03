#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

if (process.platform === "linux" && os.tmpdir().startsWith("/mnt/") && existsSync("/tmp")) {
  process.env.TMPDIR = "/tmp";
  process.env.TMP = "/tmp";
  process.env.TEMP = "/tmp";
}

const result = spawnSync(process.execPath, [tsxCli, "src/cli/index.ts", ...process.argv.slice(2)], {
  cwd: repoRoot,
  env: process.env,
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
