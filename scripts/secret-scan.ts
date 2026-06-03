import { readFile } from "node:fs/promises";
import { execa } from "execa";
import { scanSecrets } from "../src/safety/secretScanner.js";

const skipPatterns = [
  /^package-lock\.json$/,
  /^dist\//,
  /^node_modules\//,
  /^\.git\//,
  /^\.tomorrowedge\//,
  /^docs\/ui\//,
  /^tests\//
];

const { stdout } = await execa("git", ["ls-files"], { cwd: process.cwd() });
const files = stdout.split(/\r?\n/).filter(Boolean).filter((file) => !skipPatterns.some((pattern) => pattern.test(file)));
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
  process.stderr.write("Secret-like values found in tracked files:\n");
  for (const finding of findings) {
    process.stderr.write(`- ${finding.file}:${finding.line} ${finding.kind} ${finding.preview}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write("No secret-like values found in tracked files.\n");
}
