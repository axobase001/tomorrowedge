import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ContextSelection } from "../context/fileSelector.js";
import type { Plan } from "../../schemas/plan.js";

export type ReadOnlyTaskResult = {
  evidence: string[];
  artifactText: string;
  userReply: string;
  userReplySource: "local" | "handoff";
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
    const localReply = buildLocalReadOnlyReply(plan.goal, contextSelection?.contextSummary);
    return {
      artifactText,
      userReply: localReply.text,
      userReplySource: localReply.source,
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
    userReply: [
      `Here is the requested read-only inspection for ${target}:`,
      "",
      described.text
    ].join("\n"),
    userReplySource: "local",
    evidence: [
      `Read-only request completed for ${target}.`,
      described.summary,
      "No file writes, shell commands, patch approvals, or repair loops were performed.",
      described.text
    ]
  };
}

function buildLocalReadOnlyReply(goal: string, contextSummary?: string): { text: string; source: "local" | "handoff" } {
  if (isGreeting(goal)) {
    return {
      source: "local",
      text: "Hello. I am TomorrowEdge, your local multi-agent coding cockpit. Tell me the task, constraints, and access mode you want, and I can route it through the workflow."
    };
  }
  if (contextSummary?.trim()) {
    return {
      source: "local",
      text: [
        "I completed a read-only pass and did not modify files or run shell commands.",
        "",
        contextSummary.trim()
      ].join("\n")
    };
  }
  return {
    source: "handoff",
    text: [
      "I could not produce a model-backed answer from local context alone.",
      "Configure at least one answer-capable provider, then rerun this request for a full natural-language response."
    ].join("\n")
  };
}

function isGreeting(goal: string): boolean {
  return /^(hi|hello|hey|morning|good morning|good evening|你好|嗨|早|早上好|晚上好)[!！.\s]*$/i.test(goal.trim());
}

function resolveReadOnlyTarget(cwd: string, goal: string): string | undefined {
  const explicit = extractExplicitPath(goal);
  if (!explicit) return undefined;
  const desktopMentioned = /desktop|\u684c\u9762/i.test(goal);
  if (path.isAbsolute(explicit)) return path.normalize(explicit);
  if (desktopMentioned) return path.join(os.homedir(), "Desktop", explicit);
  const resolved = path.resolve(cwd, explicit);
  if (isLikelyPathToken(explicit) || existsSync(resolved)) return resolved;
  return undefined;
}

function extractExplicitPath(goal: string): string | undefined {
  const quoted = /[`"'"\u201c\u201d\u300c\u300e]([^`"'"\u201c\u201d\u300d\u300f]+)[`"'"\u201c\u201d\u300d\u300f]/.exec(goal);
  if (quoted?.[1]?.trim()) return cleanupTarget(quoted[1]);

  const windowsPath = /([A-Za-z]:[\\/][^\s,;，。；]+)/.exec(goal);
  if (windowsPath?.[1]) return cleanupTarget(windowsPath[1]);

  const desktopFolder = /(?:desktop|\u684c\u9762)\s*(?:\u7684|\u4e0b|\u91cc|\u4e2d|:|\uff1a)?\s*([A-Za-z0-9_.@()[\]\-\u4e00-\u9fff ]+?)\s*(?:\u6587\u4ef6\u5939|\u76ee\u5f55|folder|directory)/i.exec(goal);
  if (desktopFolder?.[1]?.trim()) return cleanupTarget(desktopFolder[1]);

  const namedFolder = /([A-Za-z0-9_.@()[\]\-\u4e00-\u9fff]+)\s*(?:\u6587\u4ef6\u5939|\u76ee\u5f55|folder|directory)/i.exec(goal);
  if (namedFolder?.[1]?.trim()) return cleanupTarget(namedFolder[1]);

  const relativePath = /(?:\u8bfb\u53d6|\u67e5\u770b|\u5217\u51fa|inspect|list|read)\s+([A-Za-z0-9_.@()[\]\-\\/]+)/i.exec(goal);
  if (relativePath?.[1]?.trim()) return cleanupTarget(relativePath[1]);
  return undefined;
}

function cleanupTarget(value: string): string {
  return value.trim().replace(/[,;，。；]+$/g, "").replace(/^(?:\u7684|\u4e0b|\u91cc|\u4e2d)\s*/g, "");
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
    const connector = isLast ? "`-- " : "|-- ";
    const childPath = path.join(root, entry.name);
    counter.count += 1;
    lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}`);
    if (entry.isDirectory()) {
      await appendDirectoryTree(childPath, lines, `${prefix}${isLast ? "    " : "|   "}`, depth + 1, counter);
    }
  }
}
