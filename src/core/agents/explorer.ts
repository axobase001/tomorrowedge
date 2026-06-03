import { BaseAgent } from "./baseAgent.js";
import type { AgentContext } from "./baseAgent.js";
import type { Plan } from "../../schemas/plan.js";
import type { ContextSelection } from "../context/fileSelector.js";
import { indexRepository } from "../context/repoIndexer.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

export class ExplorerAgent extends BaseAgent<{ plan: Plan }, ContextSelection> {
  readonly role = "explorer";

  async run(input: { plan: Plan }, context: AgentContext): Promise<ContextSelection> {
    const files = await indexRepository(context.cwd);
    const keywords = extractKeywords(input.plan);
    const scored = await Promise.all(
      files
        .filter((file) => file.risk === "safe")
        .map(async (file) => {
          const content = await readSmallTextFile(path.join(context.cwd, file.path), file.sizeBytes);
          const score = scoreFile(file.path, content, keywords, input.plan);
          return { file, score, matched: matchedKeywords(file.path, content, keywords) };
        })
    );
    const selected = scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
      .slice(0, 12)
      .map((item) => ({
        path: item.file.path,
        reason: item.matched.length
          ? `Matched task context: ${item.matched.slice(0, 5).join(", ")}.`
          : `Relevant ${input.plan.taskType} project file selected by metadata.`,
        risk: item.file.risk
      }));
    return {
      selectedFiles: selected,
      excludedFiles: files.filter((file) => file.risk !== "safe").map((file) => ({ path: file.path, reason: `Excluded as ${file.risk}.` })),
      grepQueriesUsed: keywords,
      contextSummary: selected.length ? `Selected ${selected.length} task-relevant files from ${keywords.length} query terms.` : "No task-relevant safe files selected yet."
    };
  }
}

function extractKeywords(plan: Plan): string[] {
  const text = [plan.goal, plan.taskType, ...(plan.expectedFiles ?? []), ...(plan.steps.flatMap((step) => [step.title, step.detail]))].join(" ");
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9_./ -]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !stopWords.has(item));
  const pathTerms = (plan.expectedFiles ?? []).flatMap((file) => file.toLowerCase().split(/[\\/._-]/).filter((item) => item.length >= 2));
  return [...new Set([...raw, ...pathTerms])].slice(0, 24);
}

function scoreFile(filePath: string, content: string, keywords: string[], plan: Plan): number {
  const lowerPath = filePath.toLowerCase();
  const lowerContent = content.toLowerCase();
  let score = 0;
  for (const expected of plan.expectedFiles ?? []) {
    if (lowerPath.endsWith(expected.toLowerCase())) score += 60;
  }
  for (const keyword of keywords) {
    if (lowerPath.includes(keyword)) score += 12;
    if (lowerContent.includes(keyword)) score += 3;
  }
  if (/\b(package\.json|tsconfig\.json|vite\.config|jest\.config|vitest\.config)\b/i.test(filePath)) score += 8;
  if (/\b(test|spec)\b|\.test\.|\.spec\./i.test(filePath)) score += plan.taskType === "test" || plan.taskType === "bugfix" ? 14 : 6;
  if (/\.(ts|tsx|js|jsx|py|rs|go)$/.test(lowerPath)) score += 6;
  if (/\b(readme|docs?)\b/i.test(filePath)) score += plan.taskType === "docs" ? 18 : 1;
  return score;
}

function matchedKeywords(filePath: string, content: string, keywords: string[]): string[] {
  const haystack = `${filePath}\n${content.slice(0, 8000)}`.toLowerCase();
  return keywords.filter((keyword) => haystack.includes(keyword));
}

async function readSmallTextFile(filePath: string, sizeBytes: number): Promise<string> {
  if (sizeBytes > 128_000) return "";
  return readFile(filePath, "utf8").catch(() => "");
}

const stopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "fix",
  "add",
  "run",
  "task",
  "step",
  "code",
  "file",
  "test"
]);
