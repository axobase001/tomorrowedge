import { execa } from "execa";
import process from "node:process";
import { pathToFileURL } from "node:url";

export type AuditResult = {
  exitCode: number;
  output: string;
};

export function isUnsupportedAuditEndpoint(output: string): boolean {
  return /audit endpoint returned an error|\/-\/npm\/v1\/security\/advisories\/bulk|\/-\/npm\/v1\/security\/audits|404 Not Found/i.test(output);
}

export function shouldSkipAudit(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes)$/i.test(env.SKIP_AUDIT ?? "");
}

export function auditExitCode(result: AuditResult): number {
  if (result.exitCode === 0) return 0;
  return isUnsupportedAuditEndpoint(result.output) ? 0 : result.exitCode;
}

export async function runAuditCheck(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (shouldSkipAudit(env)) {
    process.stderr.write("Skipping npm audit because SKIP_AUDIT is set.\n");
    return 0;
  }

  const result = await execa("npm", ["audit", "--audit-level=high"], {
    cwd,
    reject: false,
    all: true,
    env
  });
  const output = result.all ?? [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (output) {
    const stream = result.exitCode === 0 ? process.stdout : process.stderr;
    stream.write(output.endsWith("\n") ? output : `${output}\n`);
  }
  const exitCode = auditExitCode({ exitCode: result.exitCode ?? 1, output });
  if (exitCode === 0 && result.exitCode !== 0) {
    process.stderr.write("npm audit endpoint is unavailable for the configured registry; continuing verify after warning.\n");
  }
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runAuditCheck();
}
