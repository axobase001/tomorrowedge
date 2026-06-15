import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { DesiredStateDiff, EvaluationResult, GoalSpec, ObservedWorkspaceState } from "./specs.js";

const execFileAsync = promisify(execFile);

export type WorkspaceSnapshot = {
  files: Record<string, string>;
  hash: string;
};

export async function observeWorkspace(cwd: string, baseline?: WorkspaceSnapshot): Promise<ObservedWorkspaceState> {
  const git = await gitChangedFiles(cwd);
  const snapshot = await createWorkspaceSnapshot(cwd);
  if (baseline) {
    const files = diffSnapshots(baseline, snapshot);
    return {
      files_changed: files,
      changed_file_count: files.length,
      git_available: git.available,
      diff_basis: "run_baseline",
      snapshot_hash: snapshot.hash
    };
  }

  if (git.available) {
    return {
      files_changed: git.files,
      changed_file_count: git.files.length,
      git_available: true,
      diff_basis: "git_status",
      snapshot_hash: snapshot.hash
    };
  }

  return {
    files_changed: [],
    changed_file_count: 0,
    git_available: false,
    diff_basis: "snapshot",
    snapshot_hash: snapshot.hash
  };
}

export async function createWorkspaceSnapshot(cwd: string): Promise<WorkspaceSnapshot> {
  const entries = await fg(["**/*"], {
    cwd,
    onlyFiles: true,
    dot: true,
    ignore: ["node_modules/**", "dist/**", ".git/**", ".runs/**", ".tomorrowedge/**"],
    absolute: false
  });
  const files: Record<string, string> = {};
  for (const entry of entries.sort()) {
    const normalized = normalizePath(entry);
    const content = await readFile(path.join(cwd, entry));
    files[normalized] = createHash("sha256").update(content).digest("hex");
  }
  const hash = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  return { files, hash };
}

export function computeDesiredStateDiff(goal: GoalSpec, evaluation?: EvaluationResult): DesiredStateDiff {
  if (!evaluation) {
    const required = goal.desired_state.success_conditions.filter((item) => item.required).map((item) => item.id);
    return {
      missing_conditions: required,
      satisfied_conditions: [],
      regressions: [],
      unknown_conditions: goal.desired_state.success_conditions.filter((item) => !item.required).map((item) => item.id)
    };
  }
  const known = new Set([...evaluation.satisfied_conditions, ...evaluation.missing_conditions]);
  return {
    missing_conditions: evaluation.missing_conditions,
    satisfied_conditions: evaluation.satisfied_conditions,
    regressions: evaluation.regressions,
    unknown_conditions: goal.desired_state.success_conditions.filter((item) => !known.has(item.id)).map((item) => item.id)
  };
}

export function findDeniedPathViolations(changedFiles: string[], deniedPaths: string[]): string[] {
  const denied = deniedPaths.map(normalizePath).filter(Boolean);
  return changedFiles.filter((file) => {
    const normalized = normalizePath(file);
    return denied.some((item) => normalized === item || normalized.startsWith(`${item}/`));
  });
}

export function findAllowedPathViolations(changedFiles: string[], allowedPaths: string[]): string[] {
  const allowed = allowedPaths.map(normalizePath).filter(Boolean);
  if (!allowed.length || allowed.includes(".")) return [];
  return changedFiles.filter((file) => {
    const normalized = normalizePath(file);
    return !allowed.some((item) => normalized === item || normalized.startsWith(`${item}/`));
  });
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}

function diffSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
  const keys = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  const changed: string[] = [];
  for (const key of [...keys].sort()) {
    if (before.files[key] !== after.files[key]) changed.push(key);
  }
  return changed;
}

async function gitChangedFiles(cwd: string): Promise<{ available: boolean; files: string[] }> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--", "."], { cwd, windowsHide: true });
    const files = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^..\s+/, ""))
      .map((line) => line.includes(" -> ") ? line.split(" -> ").at(-1) ?? line : line)
      .map(normalizePath);
    return { available: true, files };
  } catch {
    return { available: false, files: [] };
  }
}
