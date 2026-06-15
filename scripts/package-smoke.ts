import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { execa } from "execa";

export type PackFile = {
  path: string;
};

export function parseNpmPackFiles(stdout: string): string[] {
  const parsed = JSON.parse(stdout) as Array<{ files?: PackFile[] }>;
  return parsed.flatMap((item) => item.files?.map((file) => file.path) ?? []);
}

export function assertCockpitAssetPaths(paths: string[]): void {
  const normalized = paths.map(normalizeArtifactPath);
  const hasIndex = normalized.includes("dist/cockpit-web/index.html");
  const hasScript = normalized.some((item) => /^dist\/cockpit-web\/assets\/.+\.js$/.test(item));
  const hasStyle = normalized.some((item) => /^dist\/cockpit-web\/assets\/.+\.css$/.test(item));
  const missing = [
    hasIndex ? undefined : "dist/cockpit-web/index.html",
    hasScript ? undefined : "dist/cockpit-web/assets/*.js",
    hasStyle ? undefined : "dist/cockpit-web/assets/*.css"
  ].filter((item): item is string => Boolean(item));
  if (missing.length) throw new Error(`Package is missing cockpit-web assets: ${missing.join(", ")}`);
}

export function assertSiriusExamplePaths(paths: string[]): void {
  const normalized = paths.map(normalizeArtifactPath);
  const required = [
    "examples/configs/sirius-codex-deepseek-mimo.mock.yaml",
    "examples/agent-council-rust-rewrite/mock-command-agent.mjs"
  ];
  const missing = required.filter((item) => !normalized.includes(item));
  if (missing.length) throw new Error(`Package is missing Sirius example files: ${missing.join(", ")}`);
}

export function assertCanopusExamplePaths(paths: string[]): void {
  const normalized = paths.map(normalizeArtifactPath);
  const required = [
    "examples/canopus/simple_bugfix_runtime/objective.yaml",
    "examples/canopus/simple_bugfix_runtime/fix-bug.mjs",
    "examples/canopus/simple_bugfix_runtime/index.js",
    "examples/canopus/simple_bugfix_runtime/test.js"
  ];
  const missing = required.filter((item) => !normalized.includes(item));
  if (missing.length) throw new Error(`Package is missing Canopus example files: ${missing.join(", ")}`);
}

export function assertReadmeScreenshotPaths(paths: string[]): void {
  const normalized = paths.map(normalizeArtifactPath);
  const required = [
    "docs/ui/screenshots/gui-v1.5/council-main.png",
    "docs/ui/screenshots/gui-v1.5/council-details.png",
    "docs/ui/screenshots/gui-v1.5/key-role-manager.png",
    "docs/ui/screenshots/gui-v1.5/role-assignment.png"
  ];
  const missing = required.filter((item) => !normalized.includes(item));
  if (missing.length) throw new Error(`Package is missing README screenshot files: ${missing.join(", ")}`);
}

export async function runPackageSmoke(cwd = process.cwd()): Promise<void> {
  assertCockpitAssetPaths([
    "dist/cockpit-web/index.html",
    ...(await listBuiltCockpitAssetPaths(cwd))
  ]);

  const packDir = await mkdtemp(path.join(os.tmpdir(), "tedge-package-smoke-pack-"));
  const installDir = await mkdtemp(path.join(os.tmpdir(), "tedge-package-smoke-install-"));
  const pack = await execa("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], { cwd });
  const packFiles = parseNpmPackFiles(pack.stdout);
  assertCockpitAssetPaths(packFiles);
  assertSiriusExamplePaths(packFiles);
  assertCanopusExamplePaths(packFiles);
  assertReadmeScreenshotPaths(packFiles);
  const packed = JSON.parse(pack.stdout) as Array<{ filename: string }>;
  const tarball = path.join(packDir, packed[0]?.filename ?? "");
  if (!tarball) throw new Error("npm pack did not return a tarball filename.");

  await writeFile(path.join(installDir, "package.json"), JSON.stringify({ name: "tomorrowedge-package-smoke", private: true }, null, 2), "utf8");
  await execa("npm", ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"], { cwd: installDir });
  await assertInstalledClientServesCockpit(installDir);
  await assertInstalledSiriusMockConfig(installDir);
  process.stdout.write(`Package smoke passed. Temp dirs kept: ${packDir} ${installDir}\n`);
}

async function listBuiltCockpitAssetPaths(cwd: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const assetsDir = path.join(cwd, "dist", "cockpit-web", "assets");
  const names = await readdir(assetsDir);
  return names.map((name) => `dist/cockpit-web/assets/${name}`);
}

async function assertInstalledClientServesCockpit(installDir: string): Promise<void> {
  const cliPath = await firstExistingPath([
    path.join(installDir, "node_modules", "@axobase001", "tomorrowedge", "dist", "cli", "index.js"),
    path.join(installDir, "node_modules", "tomorrowedge", "dist", "cli", "index.js")
  ]);
  const run = await execa(process.execPath, [cliPath, "client", "--no-open", "--port", "0", "--smoke-once"], {
    cwd: installDir,
    timeout: 20_000,
    killSignal: "SIGKILL"
  });
  if (!/TomorrowEdge GUI client:\s+http:\/\/127\.0\.0\.1:\d+/.test(run.stdout)) {
    throw new Error(`Installed client did not print a cockpit URL. Output:\n${run.stdout}\n${run.stderr}`);
  }
  if (!run.stdout.includes("Smoke check passed.")) {
    throw new Error(`Installed client smoke check did not finish cleanly. Output:\n${run.stdout}\n${run.stderr}`);
  }
}

async function assertInstalledSiriusMockConfig(installDir: string): Promise<void> {
  const cliPath = await firstExistingPath([
    path.join(installDir, "node_modules", "@axobase001", "tomorrowedge", "dist", "cli", "index.js"),
    path.join(installDir, "node_modules", "tomorrowedge", "dist", "cli", "index.js")
  ]);
  const packageRoot = path.resolve(path.dirname(cliPath), "..", "..");
  const configPath = path.join(packageRoot, "examples", "configs", "sirius-codex-deepseek-mimo.mock.yaml");
  const exampleCwd = path.join(packageRoot, "examples", "agent-council-rust-rewrite");
  const run = await execa(process.execPath, [
    cliPath,
    "council",
    "run",
    "--headless",
    "--fixture-mode",
    "--config",
    configPath,
    "--cwd",
    exampleCwd,
    "rebuild this JS CLI app in Rust"
  ], {
    cwd: installDir,
    timeout: 30_000
  });
  const payload = JSON.parse(run.stdout) as {
    configSource?: string;
    chiefAgent?: { id?: string; provider?: string };
    eventTypeCounts?: Record<string, number>;
    finalChiefReview?: { source?: string };
    traceCompleteness?: { score?: number };
    traceEventSample?: Array<{ type?: string; source?: string }>;
  };
  if (payload.configSource !== "explicit") throw new Error(`Installed Sirius mock did not use explicit config: ${payload.configSource ?? "missing"}`);
  if (payload.chiefAgent?.id !== "codex" || payload.chiefAgent.provider !== "external:codex") {
    throw new Error(`Installed Sirius mock selected unexpected chief agent: ${JSON.stringify(payload.chiefAgent)}`);
  }
  if ((payload.eventTypeCounts?.council_move ?? 0) < 1) throw new Error("Installed Sirius mock did not record council moves.");
  if (!payload.traceEventSample?.some((event) => event.type === "council_move" && event.source === "agent")) {
    throw new Error("Installed Sirius mock did not record agent-backed council moves.");
  }
  if (payload.finalChiefReview?.source !== "chief_agent") {
    throw new Error(`Installed Sirius mock final review was not chief-backed: ${payload.finalChiefReview?.source ?? "missing"}`);
  }
  if ((payload.traceCompleteness?.score ?? 0) < 90) {
    throw new Error(`Installed Sirius mock trace completeness too low: ${payload.traceCompleteness?.score ?? "missing"}`);
  }
}

async function firstExistingPath(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next install layout.
    }
  }
  throw new Error(`Could not find installed TomorrowEdge CLI. Checked:\n${candidates.join("\n")}`);
}

function normalizeArtifactPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^(package|tomorrowedge)\//, "");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runPackageSmoke();
}
