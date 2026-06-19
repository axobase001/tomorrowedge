import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

type PackageJson = {
  version: string;
};

const cwd = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as PackageJson;
const statusPath = path.join(cwd, "docs", "CAPABILITY_STATUS.md");
const statusText = readFileSync(statusPath, "utf8");
const promiseMapPath = path.join(cwd, "docs", "README_PROMISE_MAP.md");
const promiseMapText = readFileSync(promiseMapPath, "utf8");
const roadmapPath = path.join(cwd, "docs", "ROADMAP.md");
const roadmapText = readFileSync(roadmapPath, "utf8");
const requiredCapabilities = [
  "Offline fixture/mock workflow",
  "Access modes and full-access trace",
  "Event ledger, artifacts, trace/export",
  "Provider configuration and OpenAI-compatible adapters",
  "Live advisory and live patch candidates",
  "MCP Agent Bridge",
  "Local browser cockpit API",
  "Orchestration backend abstraction"
];

const failures: string[] = [];
if (!statusText.includes(`TomorrowEdge ${packageJson.version}`)) {
  failures.push(`docs/CAPABILITY_STATUS.md must mention TomorrowEdge ${packageJson.version}.`);
}
for (const capability of requiredCapabilities) {
  if (!statusText.includes(capability)) failures.push(`docs/CAPABILITY_STATUS.md is missing capability: ${capability}`);
}

const staleDocs = ["docs/PRODUCTIZATION_BASELINE.md", "docs/SCOPE_STATUS.md", "README.md", "docs/ROADMAP.md"];
for (const relativePath of staleDocs) {
  const text = readFileSync(path.join(cwd, relativePath), "utf8");
  const stale = text.match(/TomorrowEdge\s+0\.[0-9]+\.[0-9]+/g);
  if (stale?.length) failures.push(`${relativePath} contains stale version wording: ${[...new Set(stale)].join(", ")}`);
}

if (!promiseMapText.includes(`TomorrowEdge ${packageJson.version}`)) {
  failures.push(`docs/README_PROMISE_MAP.md must mention TomorrowEdge ${packageJson.version}.`);
}

const requiredRoadmapMarkers = [
  `TomorrowEdge ${packageJson.version}`,
  "Canopus Convergence Hardening",
  "Sirius Council Clarity",
  "delegated execution mode"
];

for (const marker of requiredRoadmapMarkers) {
  if (!roadmapText.includes(marker)) failures.push(`docs/ROADMAP.md is missing current roadmap marker: ${marker}`);
}

const requiredPromiseIds = [
  "gui-entrypoint",
  "task-queue",
  "workflow-main",
  "approval-actions",
  "telemetry-summary",
  "detail-drawer",
  "trace-strip",
  "command-composer",
  "runtime-screenshots",
  "desktop-entrypoint",
  "desktop-lifecycle",
  "desktop-port-fallback",
  "react-primary-client",
  "package-assets",
  "zip-assets"
];

for (const promiseId of requiredPromiseIds) {
  if (!promiseMapText.includes(`| ${promiseId} |`)) {
    failures.push(`docs/README_PROMISE_MAP.md is missing README promise id: ${promiseId}`);
  }
}

const readmeText = readFileSync(path.join(cwd, "README.md"), "utf8");

if (!readmeText.includes("docs/README_PROMISE_MAP.md")) {
  failures.push("README.md must link to docs/README_PROMISE_MAP.md.");
}

const requiredReadmeVersionMarkers = [
  `Current version: \`${packageJson.version}\`.`,
  packageJson.version
];

for (const marker of requiredReadmeVersionMarkers) {
  if (!readmeText.includes(marker)) failures.push(`README.md must include current version marker: ${marker}`);
}

if (failures.length) {
  process.stderr.write(`Docs status check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Docs status check passed.\n");
}
