import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { TomorrowEdgeConfig } from "../../config/schema.js";
import { livePatchResponseSchema, type PatchCandidate } from "../../schemas/patchCandidate.js";
import type { Plan } from "../../schemas/plan.js";
import { makeId } from "../../utils/ids.js";
import type { ContextSelection } from "../context/fileSelector.js";
import { estimateCostUsd } from "./costAccounting.js";
import type { ModelRouter } from "../routing/router.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { ModelNote } from "../../schemas/modelNote.js";
import type { StructuredVisualSpec } from "../../schemas/visualSpec.js";
import { chatWithProviderFallback } from "./providerFallback.js";
import type { EventLedger } from "../events/eventLedger.js";
import { isBinaryLikePath } from "../../safety/fileRisk.js";
import { textQualityIssueForUnifiedDiff } from "../patch/patchValidator.js";

const maxPatchCompletionTokens = 3600;
const maxFileChars = 2400;
const maxExplicitFileChars = 16000;
const maxContextFiles = 8;
const maxExplicitTargetFiles = 6;
export type LivePatchInput = {
  cwd: string;
  goal: string;
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  plan: Plan;
  contextSelection: ContextSelection;
  visualSpec?: StructuredVisualSpec;
  ledger?: EventLedger;
  allowParallelRoles?: boolean;
};

export type LivePatchPlan = {
  role: "coder_a" | "coder_b";
  provider: string;
  model: string;
  prompt: string;
  maxOutputTokens: number;
};

export async function buildLivePatchPlans(input: LivePatchInput): Promise<LivePatchPlan[]> {
  const roles: Array<"coder_a" | "coder_b"> = input.allowParallelRoles === false ? ["coder_a"] : ["coder_a", "coder_b"];
  const context = await buildPatchContext(input.cwd, input.goal, input.contextSelection, input.config.privacy.allow_cloud_repo_context);
  return roles.map((role) => {
    const assignment = input.router.assignmentFor(role);
    return {
      role,
      provider: assignment.provider,
      model: assignment.model,
      prompt: buildPatchPrompt(input, role, context),
      maxOutputTokens: maxPatchCompletionTokens
    };
  });
}

export async function runLivePatchCandidates(input: LivePatchInput): Promise<{ candidates: PatchCandidate[]; notes: ModelNote[] }> {
  const plans = await buildLivePatchPlans(input);
  const results = await Promise.all(plans.map((plan) => runPatchPlan(input, plan)));
  return {
    candidates: results.map((result) => result.candidate),
    notes: results.map((result) => result.note)
  };
}

async function runPatchPlan(input: LivePatchInput, plan: LivePatchPlan): Promise<{ candidate: PatchCandidate; note: ModelNote }> {
  const noteBase: ModelNote = {
    id: makeId(`note_${plan.role}`),
    role: plan.role,
    provider: plan.provider,
    model: plan.model,
    kind: "patch_generation",
    content: ""
  };

  const first = await requestPatchJson(input, plan, plan.prompt);
  let result = first.result;
  let parseError: string | undefined;
  let retryUsed = false;

  if (result.response) {
    try {
      return buildCandidateFromResponse(input, plan, noteBase, result, result.response.content);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }

  if (result.response && parseError) {
    retryUsed = true;
    const retry = await requestPatchJson(input, plan, buildRetryPrompt(plan.prompt, result.response.content, parseError));
    result = retry.result;
    if (result.response) {
      try {
        const built = buildCandidateFromResponse(input, plan, noteBase, result, result.response.content);
        return {
          candidate: built.candidate,
          note: {
            ...built.note,
            content: `${built.note.content}\n\nSchema retry recovered from: ${parseError}`,
            retryUsed: true
          }
        };
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  if (!result.response) {
    const message = result.error ?? "Live patch provider failed.";
    return {
      candidate: emptyCandidate(plan.role, message, input.plan),
      note: { ...noteBase, error: message, fallbackReason: result.fallbackReason, retryUsed }
    };
  }

  const message = parseError ?? "Live patch response was not usable.";
  return {
    candidate: emptyCandidate(plan.role, message, input.plan),
    note: {
      ...noteBase,
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      fallbackFrom: result.fallbackFrom,
      fallbackReason: result.fallbackReason,
      error: message,
      retryUsed
    }
  };
}

async function requestPatchJson(input: LivePatchInput, plan: LivePatchPlan, prompt: string) {
  const result = await chatWithProviderFallback({
    config: input.config,
    router: input.router,
    role: plan.role,
    provider: plan.provider,
    model: plan.model,
    ledger: input.ledger,
    buildRequest: (model, provider) => ({
      model,
      messages: [
        {
          role: "system",
          content:
            "You generate conservative code patches. Return ONLY JSON with keys summary, unifiedDiff, filesChanged, testPlan, knownTradeoffs, estimatedRisk. unifiedDiff must be a standard git-style unified diff. Do not use markdown fences."
        },
        { role: "user", content: prompt }
      ],
      temperature: plan.role === "coder_a" ? 0.15 : 0.35,
      maxCompletionTokens: plan.maxOutputTokens,
      responseFormat: shouldUseJsonResponseFormat(provider, model) ? { type: "json_object" } : undefined
    })
  });
  return { result };
}

function buildCandidateFromResponse(input: LivePatchInput, plan: LivePatchPlan, noteBase: ModelNote, result: Awaited<ReturnType<typeof chatWithProviderFallback>>, content: string): { candidate: PatchCandidate; note: ModelNote } {
  if (!result.response) throw new Error(result.error ?? "Live patch provider failed.");
  const parsed = parsePatchJson(content);
  validateUsableUnifiedDiff(parsed.unifiedDiff, parsed.filesChanged);
  const textQualityIssue = textQualityIssueForUnifiedDiff(parsed.unifiedDiff);
  if (textQualityIssue) {
    throw new Error(`Live patch response text quality issue: ${textQualityIssue}`);
  }
  const candidate: PatchCandidate = {
    candidateId: makeId(`live_${plan.role}`),
    agentId: plan.role,
    approach: plan.role === "coder_a" ? "minimal_patch" : "alternative",
    summary: parsed.summary || "Live model patch candidate.",
    filesChanged: parsed.filesChanged.length ? parsed.filesChanged : inferFilesFromDiff(parsed.unifiedDiff),
    unifiedDiff: parsed.unifiedDiff,
    testPlan: parsed.testPlan.length ? parsed.testPlan : input.plan.verificationCommands ?? [],
    knownTradeoffs: parsed.knownTradeoffs,
    estimatedRisk: parsed.estimatedRisk
  };
  return {
    candidate,
    note: {
      ...noteBase,
      provider: result.provider,
      model: result.model,
      content: candidate.summary,
      usage: result.response.usage,
      estimatedCostUsd: estimateCostUsd(result.provider, result.response.usage),
      fallbackUsed: result.fallbackUsed,
      fallbackFrom: result.fallbackFrom,
      fallbackReason: result.fallbackReason
    }
  };
}

async function buildPatchContext(cwd: string, goal: string, contextSelection: ContextSelection, allowCloudRepoContext: boolean): Promise<string> {
  const chunks: string[] = [];
  const explicitTargets = await explicitTargetFiles(cwd, goal);
  const seen = new Set<string>();
  for (const filePath of explicitTargets) {
    seen.add(filePath);
    chunks.push(await contextChunk(cwd, filePath, "Explicitly mentioned in task; treat as pinned target context.", allowCloudRepoContext, maxExplicitFileChars));
  }
  for (const file of contextSelection.selectedFiles.filter((item) => item.risk === "safe" && !seen.has(item.path)).slice(0, maxContextFiles)) {
    seen.add(file.path);
    chunks.push(await contextChunk(cwd, file.path, file.reason, allowCloudRepoContext, maxFileChars));
  }
  return chunks.join("\n\n---\n\n");
}

async function contextChunk(cwd: string, filePath: string, reason: string, allowCloudRepoContext: boolean, maxChars: number): Promise<string> {
  if (!allowCloudRepoContext) {
    return `FILE: ${filePath}\nCONTENT: omitted because privacy.allow_cloud_repo_context=false\nREASON: ${reason}`;
  }
  if (isBinaryLikePath(filePath)) {
    return `FILE: ${filePath}\nCONTENT: omitted because binary/image files are not safe text patch context\nREASON: ${reason}`;
  }
  const absolute = path.join(cwd, filePath);
  const content = await readFile(absolute, "utf8").catch(() => "");
  return `FILE: ${filePath}\nREASON: ${reason}\n${content.slice(0, maxChars)}`;
}

async function explicitTargetFiles(cwd: string, goal: string): Promise<string[]> {
  const candidates = [...goal.matchAll(/(?:^|[\s`"'(:])((?:(?:[A-Za-z0-9_.@()[\]-]+[\\/])+)?[A-Za-z0-9_.@()[\]-]+\.[A-Za-z0-9]{1,8})/g)]
    .map((match) => normalizeMentionedPath(match[1]))
    .filter((value): value is string => Boolean(value));
  const unique = [...new Set(candidates)].slice(0, maxExplicitTargetFiles);
  const existing: string[] = [];
  for (const filePath of unique) {
    const absolute = path.join(cwd, filePath);
    const fileStat = await stat(absolute).catch(() => undefined);
    if (fileStat?.isFile()) existing.push(filePath);
  }
  return existing;
}

function normalizeMentionedPath(raw: string): string | undefined {
  const normalized = raw.replace(/\\/g, "/").replace(/[),.;:]+$/g, "");
  if (path.isAbsolute(normalized) || normalized.includes("..")) return undefined;
  if (/^(?:node_modules|\.git|\.tomorrowedge)\//.test(normalized)) return undefined;
  if (/(^|\/)\.env(?:\.|$)/.test(normalized)) return undefined;
  return normalized;
}

function buildPatchPrompt(input: LivePatchInput, role: AgentRole, context: string): string {
  return [
    `Task: ${input.goal}`,
    `Role: ${role}`,
    `Plan risk: ${input.plan.riskLevel}`,
    `Verification commands: ${(input.plan.verificationCommands ?? []).join(" && ") || "none"}`,
    "Rules:",
    "- Prefer the smallest safe patch.",
    "- Do not modify ignored, secret, credential, lock, or generated files unless explicitly necessary.",
    "- Target files explicitly mentioned in the task are pinned in context; use their exact content and line structure.",
    "- For exact replacement tasks, change only lines containing the exact old phrase from the task. Do not edit adjacent translations, garbled text, or similar descriptions.",
    "- Preserve requested wording exactly; do not invent ranges, stronger claims, or alternate numbers.",
    "- If no safe patch can be produced, return an empty unifiedDiff and explain why in summary.",
    input.visualSpec ? "Structured visual spec:" : "",
    input.visualSpec?.handoffPrompt ?? "",
    "Context:",
    context || "No safe context files were selected."
  ].filter(Boolean).join("\n");
}

function buildRetryPrompt(originalPrompt: string, previousResponse: string, error: string): string {
  return [
    originalPrompt,
    "",
    "Your previous response could not be used as a patch.",
    `Patch error: ${error}`,
    "Return ONLY one valid JSON object with exactly these keys: summary, unifiedDiff, filesChanged, testPlan, knownTradeoffs, estimatedRisk.",
    "The unifiedDiff value must be a non-empty git-style unified diff with --- and +++ file headers and at least one hunk.",
    "All generated text must be readable valid UTF-8. Do not return mojibake, replacement characters, or garbled Chinese/CJK text.",
    "Do not include markdown fences. Escape newlines inside unifiedDiff as JSON string characters.",
    "Previous invalid response excerpt:",
    previousResponse.slice(0, 1600)
  ].join("\n");
}

function parsePatchJson(raw: string): {
  summary: string;
  unifiedDiff: string;
  filesChanged: string[];
  testPlan: string[];
  knownTradeoffs: string[];
  estimatedRisk: "low" | "medium" | "high";
} {
  const text = raw
    .trim()
    .split("\n")
    .filter((line) => !/^```/.test(line.trim()))
    .join("\n")
    .trim();
  let jsonText = extractFirstJsonObject(text);
  try {
    const parsed = livePatchResponseSchema.safeParse(JSON.parse(jsonText));
    if (!parsed.success) {
      throw new Error(`Live patch response schema mismatch: ${parsed.error.issues.map((issue) => issue.path.join(".") || issue.message).join(", ")}`);
    }
    return parsed.data;
  } catch (firstError) {
    if (jsonText.startsWith("{")) {
      const nestedStart = jsonText.indexOf("{\n");
      if (nestedStart > 0) {
        jsonText = jsonText.slice(nestedStart);
        const parsed = livePatchResponseSchema.safeParse(JSON.parse(jsonText));
        if (parsed.success) return parsed.data;
      }
    }
    throw firstError;
  }
}

function inferFilesFromDiff(diff: string): string[] {
  return [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]).filter(Boolean);
}

function shouldUseJsonResponseFormat(provider: string, model: string): boolean {
  const value = `${provider}/${model}`.toLowerCase();
  return !value.includes("deepseek");
}

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("Live patch response was not JSON.");
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error("Live patch response JSON object was not balanced.");
}

function validateUsableUnifiedDiff(diff: string, claimedFiles: string[]): void {
  const trimmed = diff.trim();
  if (!trimmed) throw new Error("Live patch response did not contain a usable unified diff.");
  if (!/^---\s+/m.test(trimmed) || !/^\+\+\+\s+/m.test(trimmed) || !/^@@\s+/m.test(trimmed)) {
    throw new Error("Live patch response did not contain a git-style unified diff with file headers and hunks.");
  }
  const diffFiles = inferFilesFromDiff(trimmed);
  const missing = claimedFiles.filter((file) => !diffFiles.includes(file));
  if (claimedFiles.length && diffFiles.length && missing.length === claimedFiles.length) {
    throw new Error(`Live patch response diff did not touch claimed files: ${claimedFiles.join(", ")}`);
  }
}

function emptyCandidate(role: "coder_a" | "coder_b", reason: string, plan: Plan): PatchCandidate {
  return {
    candidateId: makeId(`live_${role}_empty`),
    agentId: role,
    approach: role === "coder_a" ? "minimal_patch" : "alternative",
    summary: `No live patch generated: ${reason}`,
    filesChanged: [],
    unifiedDiff: "",
    testPlan: plan.verificationCommands ?? [],
    knownTradeoffs: [reason],
    estimatedRisk: "medium"
  };
}
