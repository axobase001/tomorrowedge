import { cp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execa } from "execa";
import fg from "fast-glob";

const cwd = process.cwd();
const version = process.env.npm_package_version ?? "dev";
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const output = path.resolve(process.argv[2] ?? path.join(os.homedir(), "Desktop", `tomorrowedge-${version}-latest-${stamp}.zip`));
const tempRoot = path.join(os.tmpdir(), `tomorrowedge-zip-${stamp}-${process.pid}`);
const stageRoot = path.join(tempRoot, "tomorrowedge");

const ignore = [
  ".git/**",
  "node_modules/**",
  "dist/**",
  ".tomorrowedge/**",
  ".vite/**",
  "coverage/**",
  "output/**",
  ".env",
  ".env.*",
  "*.zip",
  "*.tgz",
  "*.tar",
  "*.tar.gz"
];

await execa("npm", ["run", "secrets:scan"], { cwd, stdio: "inherit" });
await rm(tempRoot, { recursive: true, force: true });
await mkdir(stageRoot, { recursive: true });

const files = await fg(["**/*"], {
  cwd,
  dot: true,
  onlyFiles: true,
  followSymbolicLinks: false,
  ignore
});

for (const file of files) {
  const source = path.join(cwd, file);
  const target = path.join(stageRoot, file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { force: true });
}

await rm(output, { force: true });
await mkdir(path.dirname(output), { recursive: true });

if (process.platform === "win32") {
  const command = `Compress-Archive -LiteralPath '${escapePowerShellSingleQuoted(stageRoot)}' -DestinationPath '${escapePowerShellSingleQuoted(output)}' -Force`;
  await execa("powershell", [
    "-NoProfile",
    "-Command",
    command
  ], { stdio: "inherit" });
} else {
  await execa("zip", ["-qr", output, "tomorrowedge"], { cwd: tempRoot, stdio: "inherit" });
}

await assertNoEnvInZip(output);
await rm(tempRoot, { recursive: true, force: true });
process.stdout.write(`Created ${output}\n`);

async function assertNoEnvInZip(zipPath: string): Promise<void> {
  if (process.platform !== "win32") return;
  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
    `$zip=[System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}');`,
    "$hits=$zip.Entries | Where-Object { $_.FullName -match '(^|[/\\\\])\\.env(\\.|$)' };",
    "$zip.Dispose();",
    "if($hits){ throw '.env file found in zip package' }"
  ].join(" ");
  await execa("powershell", ["-NoProfile", "-Command", command], { stdio: "inherit" });
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}
