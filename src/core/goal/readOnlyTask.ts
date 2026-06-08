import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ContextSelection } from "../context/fileSelector.js";
import type { Plan } from "../../schemas/plan.js";

export type ReadOnlyTaskResult = {
  evidence: string[];
  artifactText: string;
  targetPath?: string;
};

const maxTreeDepth = 4;
const maxTreeEntries = 220;
const ignoredNames = new Set([".git", "node_modules", "dist", ".tomorrowedge"]);

export function isReadOnlyPlan(plan: Plan): boolean {
  return plan.taskType === "analysis" && !plan.verificationCommands?.length;
}

export async function buildReadOnlyTaskResult(cwd: string, plan: Plan, contextSelection?: ContextSelection): Promise<ReadOnlyTaskResult> {
  const target = resolveReadOnlyTarget(cwd, plan.goal);
  if (!target) {
    const files = contextSelection?.selectedFiles.map((file) => `- ${file.path} (${file.risk})`).join("\n") || "- No task-relevant safe files selected.";
    const artifactText = [`Read-only analysis`, `Goal: ${plan.goal}`, "", "Selected context:", files].join("\n");
    return {
      artifactText,
      evidence: [
        "Read-only request completed without patch generation.",
        contextSelection?.contextSummary ?? "No repository context selected.",
        "No file writes, shell commands, patch approvals, or repair loops were performed."
      ]
    };
  }

  const described = await describeLocalTarget(target);
  const artifactText = [`Read-only local inspection`, `Goal: ${plan.goal}`, `Target: ${target}`, "", described.text].join("\n");
  return {
    targetPath: target,
    artifactText,
    evidence: [
      `Read-only request completed for ${target}.`,
      described.summary,
      "No file writes, shell commands, patch approvals, or repair loops were performed.",
      described.text
    ]
  };
}

function resolveReadOnlyTarget(cwd: string, goal: string): string | undefined {
  const explicit = extractExplicitPath(goal);
  if (!explicit) return undefined;
  const desktopMentioned = /desktop|桌面/i.test(goal);
  if (path.isAbsolute(explicit)) return path.normalize(explicit);
  if (desktopMentioned) return path.join(os.homedir(), "Desktop", explicit);
  const resolved = path.resolve(cwd, explicit);
  if (isLikelyPathToken(explicit) || existsSync(resolved)) return resolved;
  return undefined;
}

function extractExplicitPath(goal: string): string | undefined {
  const quoted = /[`"“”'「『]([^`"“”'」』]+)[`"“”'」』]/.exec(goal);
  if (quoted?.[1]?.trim()) return cleanupTarget(quoted[1]);

  const windowsPath = /([A-Za-z]:[\\/][^\s，。；;,]+)/.exec(goal);
  if (windowsPath?.[1]) return cleanupTarget(windowsPath[1]);

  const desktopFolder = /(?:desktop|桌面)\s*(?:的|下|里|中|:|：)?\s*([A-Za-z0-9_.@()[\]\-\u4e00-\u9fff ]+?)\s*(?:文件夹|目录|folder|directory)/i.exec(goal);
  if (desktopFolder?.[1]?.trim()) return cleanupTarget(desktopFolder[1]);

  const namedFolder = /([A-Za-z0-9_.@()[\]\-\u4e00-\u9fff]+)\s*(?:文件夹|目录|folder|directory)/i.exec(goal);
  if (namedFolder?.[1]?.trim()) return cleanupTarget(namedFolder[1]);

  const relativePath = /(?:读取|查看|列出|inspect|list|read)\s+([A-Za-z0-9_.@()[\]\-\\/]+)/i.exec(goal);
  if (relativePath?.[1]?.trim()) return cleanupTarget(relativePath[1]);
  return undefined;
}

function cleanupTarget(value: string): string {
  return value.trim().replace(/[，。；;,]+$/g, "").replace(/^(?:的|下|里|中)\s*/g, "");
}

function isLikelyPathToken(value: string): boolean {
  return value.includes("/") || value.includes("\\") || value.startsWith(".") || /\.[A-Za-z0-9]+$/.test(value);
}

async function describeLocalTarget(targetPath: string): Promise<{ summary: string; text: string }> {
  try {
    const targetStat = await stat(targetPath);
    if (!targetStat.isDirectory()) {
      return {
        summary: `Target is a file (${targetStat.size} bytes).`,
        text: `${path.basename(targetPath)} (${targetStat.size} bytes)`
      };
    }
    const lines = [`${path.basename(targetPath) || targetPath}/`];
    const counter = { count: 0, truncated: false };
    await appendDirectoryTree(targetPath, lines, "", 0, counter);
    const suffix = counter.truncated ? `; truncated after ${maxTreeEntries} entries` : "";
    return {
      summary: `Directory structure captured with ${counter.count} entries${suffix}.`,
      text: lines.join("\n")
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      summary: `Target could not be inspected: ${message}`,
      text: `Unable to inspect target: ${targetPath}\n${message}`
    };
  }
}

async function appendDirectoryTree(root: string, lines: string[], prefix: string, depth: number, counter: { count: number; truncated: boolean }): Promise<void> {
  if (depth >= maxTreeDepth || counter.count >= maxTreeEntries) return;
  const entries = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => !ignoredNames.has(entry.name))
    .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name));
  for (let index = 0; index < entries.length; index += 1) {
    if (counter.count >= maxTreeEntries) {
      counter.truncated = true;
      return;
    }
    const entry = entries[index]!;
    const isLast = index === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPath = path.join(root, entry.name);
    counter.count += 1;
    lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}`);
    if (entry.isDirectory()) {
      await appendDirectoryTree(childPath, lines, `${prefix}${isLast ? "    " : "│   "}`, depth + 1, counter);
    }
  }
}
