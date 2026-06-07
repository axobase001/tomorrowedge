import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
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
  const packed = JSON.parse(pack.stdout) as Array<{ filename: string }>;
  const tarball = path.join(packDir, packed[0]?.filename ?? "");
  if (!tarball) throw new Error("npm pack did not return a tarball filename.");

  await writeFile(path.join(installDir, "package.json"), JSON.stringify({ name: "tomorrowedge-package-smoke", private: true }, null, 2), "utf8");
  await execa("npm", ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"], { cwd: installDir });
  await assertInstalledClientServesCockpit(installDir);
  process.stdout.write(`Package smoke passed. Temp dirs kept: ${packDir} ${installDir}\n`);
}

async function listBuiltCockpitAssetPaths(cwd: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const assetsDir = path.join(cwd, "dist", "cockpit-web", "assets");
  const names = await readdir(assetsDir);
  return names.map((name) => `dist/cockpit-web/assets/${name}`);
}

async function assertInstalledClientServesCockpit(installDir: string): Promise<void> {
  const cliPath = path.join(installDir, "node_modules", "tomorrowedge", "dist", "cli", "index.js");
  const child = spawn(process.execPath, [cliPath, "client", "--no-open", "--port", "0"], {
    cwd: installDir,
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const output = await waitForOutput(child, /TomorrowEdge GUI client: (http:\/\/127\.0\.0\.1:\d+\/\?nonce=[^\s]+)/);
    const url = output.match(/TomorrowEdge GUI client: (http:\/\/127\.0\.0\.1:\d+\/\?nonce=[^\s]+)/)?.[1];
    if (!url) throw new Error(`Installed client did not print a cockpit URL. Output:\n${output}`);
    const html = await fetch(url).then((response) => response.text());
    const assetPath = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    if (!html.includes('<div id="root"></div>') || !assetPath) {
      throw new Error("Installed client did not serve the React cockpit index.");
    }
    const assetUrl = new URL(assetPath, url).toString();
    const asset = await fetch(assetUrl);
    if (!asset.ok) throw new Error(`Installed client cockpit asset failed: ${asset.status} ${assetUrl}`);
  } finally {
    child.kill("SIGTERM");
  }
}

function waitForOutput(child: ReturnType<typeof spawn>, pattern: RegExp): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for installed client output. Output:\n${output}`));
    }, 15_000);
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (pattern.test(output)) {
        clearTimeout(timeout);
        resolve(output);
      }
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      if (!pattern.test(output)) {
        clearTimeout(timeout);
        reject(new Error(`Installed client exited before printing a cockpit URL: ${code}\n${output}`));
      }
    });
  });
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
