import { readFile } from "node:fs/promises";
import { execa } from "execa";
import fg from "fast-glob";
import { scanSecrets } from "../src/safety/secretScanner.js";

const skipPatterns = [
  /^package-lock\.json$/,
  /^dist\//,
  /^\.env(?:\..*)?$/,
  /^node_modules\//,
  /^\.git\//,
  /^\.tomorrowedge\//,
  /^docs\/assets\//,
  /^docs\/ui\//,
  /^tests\//,
  /^src\/core\/secrets\//,
  /^examples\/[^/]+\/tests\//,
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|tar|tgz|gz|wasm|sqlite|db|bin)$/i
];

const files = await listCandidateFiles();
const findings: Array<{ file: string; kind: string; line: number; preview: string }> = [];

for (const file of files) {
  const content = await readFile(file, "utf8").catch(() => undefined);
  if (content === undefined) continue;
  for (const finding of scanSecrets(content)) {
    if (finding.kind === "high_entropy_token" && finding.preview.startsWith("return")) continue;
    findings.push({ file, ...finding });
  }
}

if (findings.length) {
  process.stderr.write("Secret-like values found in scanned files:\n");
  for (const finding of findings) {
    process.stderr.write(`- ${finding.file}:${finding.line} ${finding.kind} ${finding.preview}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write("No secret-like values found in scanned files.\n");
}

async function listCandidateFiles(): Promise<string[]> {
  const gitFiles = await execa("git", ["ls-files"], { cwd: process.cwd() })
    .then((result) => result.stdout.split(/\r?\n/).filter(Boolean))
    .catch(() => undefined);
  const files = gitFiles ?? await fg(["**/*"], {
    cwd: process.cwd(),
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: [
      "node_modules/**",
      "dist/**",
      ".env",
      ".env.*",
      ".git/**",
      ".tomorrowedge/**",
      "docs/assets/**",
      "docs/ui/**",
      "tests/**",
      "examples/*/tests/**"
    ]
  });
  return files
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => !skipPatterns.some((pattern) => pattern.test(file)));
}
