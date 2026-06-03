import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TomorrowEdgeConfig } from "../../config/schema.js";
import { createProviderRegistry } from "../../providers/registry.js";
import type { ModelProvider } from "../../providers/types.js";
import { estimateCostUsd, preflightBudget, summarizeModelUsage } from "../model/costAccounting.js";
import type { ModelBudgetStatus, ModelNote } from "../../schemas/modelNote.js";
import { makeId } from "../../utils/ids.js";

export type AgentDrillOptions = {
  fixture?: string;
  providers?: string[];
  includeMock?: boolean;
};

export type AgentDrillResult = {
  task: string;
  fixture: string;
  planner: {
    rubric: string[];
    expectedFiles: string[];
    expectedFix: string;
  };
  budgetStatus: ModelBudgetStatus;
  runs: AgentDrillRun[];
  winner?: string;
  usageSummary: ReturnType<typeof summarizeModelUsage>;
};

export type AgentDrillRun = {
  provider: string;
  model: string;
  parsed: boolean;
  summary: string;
  unifiedDiff: string;
  score: number;
  strengths: string[];
  weaknesses: string[];
  note: ModelNote;
};

const maxDrillCompletionTokens = 1600;

export async function runAgentDrill(cwd: string, task: string, config: TomorrowEdgeConfig, options: AgentDrillOptions = {}): Promise<AgentDrillResult> {
  const fixture = options.fixture ?? "sample-repo-basic";
  const fixtureRoot = path.join(cwd, "tests", "fixtures", fixture);
  const prompt = await buildPrompt(fixtureRoot, task);
  const registry = createProviderRegistry(config);
  const providers = await selectProviders(registry.list(), options);
  const budgetStatus = preflightBudget(
    providers.map((provider) => ({ provider: provider.id, prompt, maxOutputTokens: maxDrillCompletionTokens })),
    config.routing.max_cost_usd
  );

  const runs = budgetStatus.status === "blocked" ? [] : await Promise.all(providers.map((provider) => runProviderDrill(provider, prompt)));
  const notes = runs.map((run) => run.note);
  const winner = runs.length ? [...runs].sort((a, b) => b.score - a.score)[0]?.provider : undefined;

  return {
    task,
    fixture,
    planner: {
      rubric: [
        "Produce parseable JSON.",
        "Generate a concrete unified diff.",
        "Fix add() from subtraction to addition.",
        "Touch the minimal expected file.",
        "Name a runnable verification command."
      ],
      expectedFiles: ["index.js"],
      expectedFix: "return a + b"
    },
    budgetStatus,
    runs,
    winner,
    usageSummary: summarizeModelUsage(notes)
  };
}

async function selectProviders(providers: ModelProvider[], options: AgentDrillOptions): Promise<ModelProvider[]> {
  const allowed = new Set(options.providers ?? ["openrouter", "deepseek", "mimo"]);
  return providers.filter((provider) => {
    if (!options.includeMock && provider.kind === "mock") return false;
    return allowed.has(provider.id);
  });
}

async function runProviderDrill(provider: ModelProvider, prompt: string): Promise<AgentDrillRun> {
  const [model] = await provider.listModels();
  const modelId = model?.id ?? "configured-model";
  const noteBase: ModelNote = {
    id: makeId(`drill_${provider.id}`),
    role: "coder_a",
    provider: provider.id,
    model: modelId,
    kind: "patch_generation",
    content: ""
  };

  try {
    const response = await provider.chat({
      model: modelId,
      messages: [
        {
          role: "system",
          content:
            "You are a coding implementation agent in a multi-model drill. Return ONLY JSON with keys summary, unifiedDiff, filesChanged, testPlan, estimatedRisk. No markdown fences."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      maxCompletionTokens: maxDrillCompletionTokens
    });
    const parsed = parseDrillJson(response.content);
    const evaluation = evaluatePatch(parsed);
    return {
      provider: provider.id,
      model: modelId,
      parsed: true,
      summary: parsed.summary,
      unifiedDiff: parsed.unifiedDiff,
      score: evaluation.score,
      strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses,
      note: {
        ...noteBase,
        content: parsed.summary,
        usage: response.usage,
        estimatedCostUsd: estimateCostUsd(provider.id, response.usage)
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      provider: provider.id,
      model: modelId,
      parsed: false,
      summary: `Drill failed: ${message}`,
      unifiedDiff: "",
      score: 0,
      strengths: [],
      weaknesses: [message],
      note: { ...noteBase, error: message }
    };
  }
}

async function buildPrompt(fixtureRoot: string, task: string): Promise<string> {
  const files = await Promise.all(
    ["package.json", "index.js", "test.js"].map(async (name) => {
      const content = await readFile(path.join(fixtureRoot, name), "utf8").catch(() => "");
      return `FILE: ${name}\n${content}`;
    })
  );
  return [
    `Task: ${task}`,
    "Core planner says: this is a minimal bugfix. The implementation should fix the failing test with the smallest safe code change.",
    "Core reviewer will score: parseable JSON, concrete diff, minimal file touch, correct addition behavior, runnable test plan.",
    "Return a standard git-style unified diff. Do not apply anything.",
    "Repository context:",
    files.join("\n---\n")
  ].join("\n");
}

function parseDrillJson(raw: string): {
  summary: string;
  unifiedDiff: string;
  filesChanged: string[];
  testPlan: string[];
  estimatedRisk: "low" | "medium" | "high";
} {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("response was not JSON");
  const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<{
    summary: string;
    unifiedDiff: string;
    filesChanged: string[];
    testPlan: string[];
    estimatedRisk: "low" | "medium" | "high";
  }>;
  return {
    summary: parsed.summary ?? "",
    unifiedDiff: parsed.unifiedDiff ?? "",
    filesChanged: Array.isArray(parsed.filesChanged) ? parsed.filesChanged : [],
    testPlan: Array.isArray(parsed.testPlan) ? parsed.testPlan : [],
    estimatedRisk: parsed.estimatedRisk === "medium" || parsed.estimatedRisk === "high" ? parsed.estimatedRisk : "low"
  };
}

function evaluatePatch(candidate: { unifiedDiff: string; filesChanged: string[]; testPlan: string[]; estimatedRisk: string }): {
  score: number;
  strengths: string[];
  weaknesses: string[];
} {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  let score = 20;

  if (candidate.unifiedDiff.trim()) {
    score += 20;
    strengths.push("produced a concrete diff");
  } else {
    weaknesses.push("no unified diff");
  }
  if (/return a \+ b/.test(candidate.unifiedDiff)) {
    score += 30;
    strengths.push("patch changes subtraction to addition");
  } else {
    weaknesses.push("diff does not clearly implement addition");
  }
  if (candidate.filesChanged.includes("index.js") || /\+\+\+ b\/index\.js/.test(candidate.unifiedDiff)) {
    score += 10;
    strengths.push("targets the expected file");
  } else {
    weaknesses.push("does not target index.js");
  }
  if (candidate.testPlan.some((command) => /npm test/.test(command))) {
    score += 10;
    strengths.push("includes npm test verification");
  } else {
    weaknesses.push("missing npm test verification");
  }
  if (candidate.estimatedRisk === "low") {
    score += 5;
    strengths.push("marks the small bugfix as low risk");
  }
  if (!/\.env|secret|token/i.test(candidate.unifiedDiff)) {
    score += 5;
  } else {
    weaknesses.push("diff mentions sensitive targets");
  }

  return { score: Math.min(100, score), strengths, weaknesses };
}
