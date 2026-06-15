import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { StatusSpec } from "./specs.js";

export class StatusStore {
  readonly runDir: string;

  constructor(readonly cwd: string, readonly runId: string, rootDir = ".runs") {
    this.runDir = path.resolve(cwd, rootDir, runId);
  }

  get tracePath(): string {
    return path.join(this.runDir, "trace.jsonl");
  }

  get latestPath(): string {
    return path.join(this.runDir, "status.latest.json");
  }

  get progressPath(): string {
    return path.join(this.runDir, "progress.md");
  }

  evidenceDir(iteration: number): string {
    return path.join(this.runDir, "evidence", `iteration_${String(iteration).padStart(3, "0")}`);
  }

  async initialize(): Promise<void> {
    await mkdir(path.join(this.runDir, "evidence"), { recursive: true });
  }

  async writeStatus(status: StatusSpec): Promise<void> {
    await this.initialize();
    await writeFile(this.tracePath, JSON.stringify(status) + "\n", { encoding: "utf8", flag: "a" });
    await writeFile(this.latestPath, JSON.stringify(status, null, 2), "utf8");
    await writeFile(this.progressPath, renderProgressMarkdown(status), "utf8");
  }

  async readLatest(): Promise<StatusSpec> {
    if (!existsSync(this.latestPath)) {
      throw new Error(`No status found for run ${this.runId}`);
    }
    return JSON.parse(await readFile(this.latestPath, "utf8")) as StatusSpec;
  }

  async readTrace(): Promise<StatusSpec[]> {
    if (!existsSync(this.tracePath)) return [];
    const raw = await readFile(this.tracePath, "utf8");
    return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as StatusSpec);
  }
}

export async function readControlPlaneStatus(cwd: string, runId: string): Promise<StatusSpec> {
  return new StatusStore(cwd, runId).readLatest();
}

export async function readControlPlaneReport(cwd: string, runId: string): Promise<string> {
  const store = new StatusStore(cwd, runId);
  if (!existsSync(store.progressPath)) throw new Error(`No progress report found for run ${runId}`);
  return readFile(store.progressPath, "utf8");
}

function renderProgressMarkdown(status: StatusSpec): string {
  const gateLines = status.evidence.gate_results.length
    ? status.evidence.gate_results.map((gate) => `- ${gate.passed ? "[x]" : "[ ]"} ${gate.id} (${gate.type}): ${gate.summary}`)
    : ["- none"];
  const blockerLines = status.observed_state.unresolved_blockers.length
    ? status.observed_state.unresolved_blockers.map((item) => `- ${item}`)
    : ["- none"];
  return [
    "# Run status",
    "",
    `- Goal: ${status.goal_id}`,
    `- Run: ${status.run_id}`,
    `- Current iteration: ${status.iteration}`,
    `- Phase: ${status.phase}`,
    `- Evaluation phase: ${status.evaluation_phase ?? "n/a"}`,
    `- Diff basis: ${status.observed_state.diff_basis ?? "n/a"}`,
    "",
    "## Satisfied conditions",
    ...bulletList(status.diff.satisfied_conditions),
    "",
    "## Missing conditions",
    ...bulletList(status.diff.missing_conditions),
    "",
    "## Gate results",
    ...gateLines,
    "",
    "## Current blockers",
    ...blockerLines,
    "",
    "## Next action",
    status.decision.next_action ? `- ${status.decision.next_action}` : "- none",
    "",
    "## Final verdict if stopped",
    `- ${status.decision.should_continue ? "running" : status.decision.reason}`,
    ""
  ].join("\n");
}

function bulletList(items: string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : ["- none"];
}
