import { spawn } from "node:child_process";
import { execa, type Result } from "execa";
import type { RunResult } from "../../schemas/evidence.js";
import type { ShellPolicy } from "../../config/schema.js";
import { assessShellCommand, parseShellCommand } from "../../safety/shellGuard.js";

const defaultTimeoutMs = 10 * 60 * 1000;
const defaultForceKillAfterDelayMs = 1000;

export type ShellExecutionOptions = {
  approved: boolean;
  policy?: ShellPolicy;
  verificationAllowlist?: string[];
  timeoutMs?: number;
  forceKillAfterDelayMs?: number;
};

export async function runApprovedCommand(cwd: string, command: string, approvedOrOptions: boolean | ShellExecutionOptions): Promise<RunResult> {
  const options: ShellExecutionOptions = typeof approvedOrOptions === "boolean" ? { approved: approvedOrOptions, policy: "verification_allowlist" } : approvedOrOptions;
  if (!options.approved) {
    throw new Error("Shell command blocked: approval required.");
  }
  const risk = options.policy === "verification_allowlist" ? assessShellCommand(command, options.verificationAllowlist) : parseShellCommand(command);
  if (!risk.allowed || !risk.argv?.length) {
    throw new Error(`Shell command blocked: ${risk.reason}.`);
  }
  const start = Date.now();
  const [file, ...args] = risk.argv;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const forceKillAfterDelayMs = options.forceKillAfterDelayMs ?? defaultForceKillAfterDelayMs;
  const subprocess = execa(file, args, {
    cwd,
    shell: false,
    preferLocal: true,
    reject: false,
    timeout: 0,
    detached: process.platform !== "win32",
    cleanup: process.platform === "win32",
    forceKillAfterDelay: false
  });
  let timedOut = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const completion = subprocess.then((result) => ({ result })).catch((error: unknown) => ({ error }));
  const timeout = timeoutMs > 0
    ? new Promise<{ timeout: true }>((resolve) => {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          terminateProcessTree(subprocess.pid, "SIGTERM");
          forceKillTimer = setTimeout(() => {
            terminateProcessTree(subprocess.pid, "SIGKILL");
            resolve({ timeout: true });
          }, Math.max(0, forceKillAfterDelayMs));
          forceKillTimer.unref?.();
        }, timeoutMs);
        timeoutTimer.unref?.();
      })
    : new Promise<never>(() => undefined);
  const outcome = await Promise.race([completion, timeout]);
  if (timeoutTimer) clearTimeout(timeoutTimer);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  if ("timeout" in outcome) {
    return {
      command,
      exitCode: 124,
      stdout: "",
      stderr: `Command timed out after ${timeoutMs}ms.`,
      durationMs: Date.now() - start,
      success: false,
      timedOut: true
    };
  }
  const subprocessResult = "result" in outcome ? outcome.result : resultFromError(outcome.error);
  const exitCode = timedOut ? 124 : subprocessResult.exitCode ?? 1;
  return {
    command,
    exitCode,
    stdout: stringifyOutput(subprocessResult.stdout),
    stderr: stringifyOutput(subprocessResult.stderr),
    durationMs: Date.now() - start,
    success: !timedOut && subprocessResult.exitCode === 0,
    timedOut
  };
}

function stringifyOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  if (Array.isArray(value)) return value.map((item) => stringifyOutput(item)).join("");
  return value === undefined || value === null ? "" : String(value);
}

function resultFromError(error: unknown): Partial<Result> {
  return typeof error === "object" && error
    ? error as Partial<Result>
    : { exitCode: 1, stdout: "", stderr: String(error) };
}

function terminateProcessTree(pid: number | undefined, signal: NodeJS.Signals): boolean {
  if (!pid) return false;
  if (process.platform === "win32") {
    const args = ["/pid", String(pid), "/t"];
    if (signal === "SIGKILL") args.push("/f");
    const killer = spawn("taskkill", args, { stdio: "ignore", windowsHide: true });
    killer.on("error", () => undefined);
    killer.unref();
    return true;
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}
