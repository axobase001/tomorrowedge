#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const viteCli = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

if (process.platform === "linux" && os.tmpdir().startsWith("/mnt/") && existsSync("/tmp")) {
  process.env.TMPDIR = "/tmp";
  process.env.TMP = "/tmp";
  process.env.TEMP = "/tmp";
}

const args = process.argv.slice(2);
if (shouldBuildCockpitAssets(args)) {
  const build = spawnSync(process.execPath, [viteCli, "build", "--config", "src/cockpit-web/vite.config.ts"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit"
  });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
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

function shouldBuildCockpitAssets(args) {
  const command = args.find((arg) => !arg.startsWith("-"));
  return command === "client" || command === "desktop" || command === "serve";
}
