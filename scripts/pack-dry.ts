import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { execa } from "execa";
import fg from "fast-glob";

type PackageJson = {
  files?: string[];
};

export async function findPackRelevantUntrackedFiles(cwd = process.cwd(), packageFiles = readPackageFiles(cwd), untrackedFiles?: string[]): Promise<string[]> {
  const untracked = (untrackedFiles ?? await listUntrackedFiles(cwd)).map(normalizePath);
  if (!untracked.length) return [];

  const packPatterns = packageFilesToGlobPatterns(cwd, packageFiles);
  const packFiles = new Set((await fg(packPatterns, { cwd, dot: true, onlyFiles: true, unique: true, ignore: ["node_modules/**", ".git/**"] })).map(normalizePath));
  return untracked.filter((file) => packFiles.has(file)).sort();
}

export function packageFilesToGlobPatterns(cwd: string, packageFiles: string[]): string[] {
  const alwaysIncluded = ["package.json", "README", "README.*", "LICENSE", "LICENSE.*", "CHANGELOG", "CHANGELOG.*"];
  return [...alwaysIncluded, ...packageFiles].map((entry) => normalizePackagePattern(cwd, entry));
}

export async function runPackDry(cwd = process.cwd(), args = process.argv.slice(2)): Promise<number> {
  const riskyFiles = await findPackRelevantUntrackedFiles(cwd);
  if (riskyFiles.length) {
    process.stderr.write("Refusing npm pack --dry-run because untracked files would be included in the package:\n");
    for (const file of riskyFiles) process.stderr.write(`- ${file}\n`);
    process.stderr.write("Track, move, or ignore these files before running the release pack gate.\n");
    return 1;
  }

  const result = await execa("npm", ["pack", "--dry-run", ...args], {
    cwd,
    stdio: "inherit",
    reject: false
  });
  return result.exitCode ?? 1;
}

async function listUntrackedFiles(cwd: string): Promise<string[]> {
  const result = await execa("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd,
    reject: false
  });
  if (result.exitCode !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function readPackageFiles(cwd: string): string[] {
  const packageJson = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as PackageJson;
  return packageJson.files ?? [];
}

function normalizePackagePattern(cwd: string, entry: string): string {
  const normalized = normalizePath(entry).replace(/\/+$/, "");
  if (hasGlob(normalized)) return normalized;
  const absolute = path.join(cwd, normalized);
  if (existsSync(absolute) && statSync(absolute).isDirectory()) return `${normalized}/**`;
  return normalized;
}

function hasGlob(value: string): boolean {
  return /[*?[{]/.test(value);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runPackDry();
}
