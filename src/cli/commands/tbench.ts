import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type TbenchGuideOptions = {
  json?: boolean;
};

export type TbenchSmokeOptions = {
  dataset?: string;
  limit?: string;
  n?: string;
  outputDir?: string;
  jobName?: string;
  agentImportPath?: string;
  agentTimeoutMultiplier?: string;
  primaryModel?: string;
  advisorModel?: string;
  strongModel?: string;
  escalationAfter?: string;
  maxStrongInterventions?: string;
  maxSteps?: string;
  strongMaxTokens?: string;
  requireStrong?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
};

const DEFAULT_DATASET = "terminal-bench/terminal-bench-2-1";
const DEFAULT_AGENT_IMPORT_PATH = "scripts.tbench.tomorrowedge_harbor_agent:TomorrowEdgeHarborAgent";

export function tbenchGuideCommand(cwd: string, options: TbenchGuideOptions = {}): void {
  const scriptPath = path.join(cwd, "scripts", "tbench", "tomorrowedge_harbor_agent.py");
  const payload = {
    dataset: DEFAULT_DATASET,
    agent: "tomorrowedge-canopus",
    agentImportPath: DEFAULT_AGENT_IMPORT_PATH,
    scriptPath,
    installed: existsSync(scriptPath),
    smokeCommand: buildHarborArgs({
      dataset: DEFAULT_DATASET,
      limit: "1",
      n: "1",
      outputDir: ".tomorrowedge/tbench/jobs",
      jobName: "tb21-tomorrowedge-smoke",
      agentImportPath: DEFAULT_AGENT_IMPORT_PATH,
      agentEnv: {},
      quiet: true
    }).join(" ")
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write([
    "Terminal-Bench 2.1 runtime",
    `dataset: ${payload.dataset}`,
    `agent: ${payload.agent}`,
    `adapter: ${payload.agentImportPath}`,
    `adapter file: ${payload.installed ? payload.scriptPath : `${payload.scriptPath} (missing)`}`,
    "",
    "Smoke:",
    `  harbor ${payload.smokeCommand}`,
    "",
    "TomorrowEdge records structured terminal actions, generated files, command policy decisions, verifier results, and escalation hints for this adapter."
  ].join("\n") + "\n");
}

export async function tbenchSmokeCommand(cwd: string, options: TbenchSmokeOptions = {}): Promise<void> {
  const scriptPath = path.join(cwd, "scripts", "tbench", "tomorrowedge_harbor_agent.py");
  if (!existsSync(scriptPath)) {
    throw new Error(`Terminal-Bench Harbor adapter is missing: ${scriptPath}`);
  }
  const args = buildHarborArgs({
    dataset: options.dataset ?? DEFAULT_DATASET,
    limit: options.limit ?? "1",
    n: options.n ?? "1",
    outputDir: options.outputDir ?? ".tomorrowedge/tbench/jobs",
    jobName: options.jobName ?? "tb21-tomorrowedge-smoke",
    agentImportPath: options.agentImportPath ?? DEFAULT_AGENT_IMPORT_PATH,
    agentTimeoutMultiplier: options.agentTimeoutMultiplier,
    agentEnv: terminalBenchEnv(options),
    quiet: options.quiet ?? false
  });
  if (options.dryRun) {
    process.stdout.write(`harbor ${args.join(" ")}\n`);
    return;
  }
  await spawnHarbor(args, cwd, terminalBenchEnv(options));
}

function buildHarborArgs(input: {
  dataset: string;
  limit: string;
  n: string;
  outputDir: string;
  jobName: string;
  agentImportPath: string;
  agentTimeoutMultiplier?: string;
  agentEnv: Record<string, string>;
  quiet: boolean;
}): string[] {
  const args = [
    "run",
    "-d",
    input.dataset,
    "-a",
    "tomorrowedge-canopus",
    "--agent-import-path",
    input.agentImportPath,
    "-l",
    input.limit,
    "-n",
    input.n,
    "-y",
    "-o",
    input.outputDir,
    "--job-name",
    input.jobName
  ];
  if (input.agentTimeoutMultiplier) {
    args.push("--agent-timeout-multiplier", input.agentTimeoutMultiplier);
  }
  for (const [key, value] of Object.entries(input.agentEnv)) {
    args.push("--agent-env", `${key}=${value}`);
  }
  if (input.quiet) args.push("-q");
  return args;
}

async function spawnHarbor(args: string[], cwd: string, extraEnv: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const command = process.platform === "win32" ? "cmd.exe" : "harbor";
    const spawnArgs = process.platform === "win32"
      ? ["/d", "/s", "/c", ["harbor", ...args].map(windowsShellQuote).join(" ")]
      : args;
    const child = spawn(command, spawnArgs, {
      cwd,
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        ...extraEnv,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        NO_COLOR: "1",
        RICH_NO_COLOR: "1",
        TERM: "dumb"
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`harbor exited with code ${code ?? "unknown"}`));
    });
  });
}

function windowsShellQuote(value: string): string {
  if (!/[\s"&<>|^]/.test(value)) return value;
  return `"${value.replace(/"/g, "\\\"")}"`;
}

function terminalBenchEnv(options: TbenchSmokeOptions): Record<string, string> {
  const env: Record<string, string> = {};
  if (options.primaryModel) env.TBENCH_PRIMARY_MODEL = options.primaryModel;
  if (options.advisorModel) env.TBENCH_ADVISOR_MODEL = options.advisorModel;
  if (options.strongModel) env.TBENCH_STRONG_MODEL = options.strongModel;
  if (options.escalationAfter) env.TBENCH_ESCALATION_AFTER = options.escalationAfter;
  if (options.maxStrongInterventions) env.TBENCH_MAX_STRONG_INTERVENTIONS = options.maxStrongInterventions;
  if (options.maxSteps) env.TBENCH_MAX_STEPS = options.maxSteps;
  if (options.strongMaxTokens) env.TBENCH_STRONG_MAX_OUTPUT = options.strongMaxTokens;
  if (options.requireStrong) env.TBENCH_REQUIRE_STRONG = "1";
  return env;
}
