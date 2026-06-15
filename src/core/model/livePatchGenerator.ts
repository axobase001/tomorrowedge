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
import { livePatchResponseJsonSchema, structuredJsonResponseFormat } from "./structuredOutput.js";
import type { EventLedger } from "../events/eventLedger.js";
import { isBinaryLikePath } from "../../safety/fileRisk.js";
import { textQualityIssueForUnifiedDiff } from "../patch/patchValidator.js";

const maxPatchCompletionTokens = 3600;
const maxPatchRepairCompletionTokens = 1200;
const livePatchRequestTimeoutMs = 90_000;
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
  const expectedFiles = expectedTextOutputFiles(input.goal).length;
  return roles.map((role) => {
    const assignment = input.router.assignmentFor(role);
    return {
      role,
      provider: assignment.provider,
      model: assignment.model,
      prompt: buildPatchPrompt(input, role, context),
      maxOutputTokens: expectedFiles >= 3 ? Math.max(maxPatchCompletionTokens, 5200) : maxPatchCompletionTokens
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
    const recovered = maybeRecoverDocumentCandidate(input, plan, noteBase, result, parseError, retryUsed);
    if (recovered) return recovered;
    retryUsed = true;
    const retry = await requestPatchJson(input, plan, buildRetryPrompt(plan.prompt, result.response.content, parseError), Math.min(plan.maxOutputTokens, maxPatchRepairCompletionTokens));
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
  const fallbackCandidate = buildDocumentFallbackCandidate(input, plan, result.response.content, message);
  if (fallbackCandidate) {
    return {
      candidate: fallbackCandidate,
      note: {
        ...noteBase,
        provider: result.provider,
        model: result.model,
        fallbackUsed: result.fallbackUsed,
        fallbackFrom: result.fallbackFrom,
        fallbackReason: result.fallbackReason ?? "document_response_export",
        error: message,
        content: `Recovered long-form document content into ${fallbackCandidate.filesChanged.join(", ")} after patch JSON parsing failed.`,
        usage: result.response.usage,
        estimatedCostUsd: estimateCostUsd(result.provider, result.response.usage),
        retryUsed
      }
    };
  }
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

async function requestPatchJson(input: LivePatchInput, plan: LivePatchPlan, prompt: string, maxOutputTokens = plan.maxOutputTokens) {
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
            "You generate conservative patch candidates. Return ONLY JSON with keys summary, unifiedDiff, filesChanged, testPlan, knownTradeoffs, estimatedRisk. For multi-file text generation tasks, you may return files: [{path, content}] instead of unifiedDiff; TomorrowEdge will convert that file bundle into a standard diff. Do not use markdown fences."
        },
        { role: "user", content: prompt }
      ],
      temperature: plan.role === "coder_a" ? 0.15 : 0.35,
      maxCompletionTokens: maxOutputTokens,
      timeoutMs: providerRequestTimeoutMs(input.config, provider),
      maxRetries: 0,
      responseFormat: shouldUseJsonResponseFormat(provider, model) ? structuredJsonResponseFormat(provider, "tomorrowedge_live_patch", livePatchResponseJsonSchema) : undefined
    }),
    allowSyntheticFallback: false
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
  const filesChanged = parsed.filesChanged.length ? parsed.filesChanged : inferFilesFromDiff(parsed.unifiedDiff);
  const normalizedRisk = normalizeGeneratedArtifactRisk(input.goal, parsed.estimatedRisk, filesChanged);
  const knownTradeoffs = normalizedRisk === parsed.estimatedRisk
    ? parsed.knownTradeoffs
    : [
        ...parsed.knownTradeoffs,
        "Patch application risk was normalized because changes are bounded to explicitly requested generated text artifacts; content correctness still requires review."
      ];
  const candidate: PatchCandidate = {
    candidateId: makeId(`live_${plan.role}`),
    agentId: plan.role,
    approach: plan.role === "coder_a" ? "minimal_patch" : "alternative",
    summary: parsed.summary || "Live model patch candidate.",
    filesChanged,
    unifiedDiff: parsed.unifiedDiff,
    testPlan: parsed.testPlan.length ? parsed.testPlan : input.plan.verificationCommands ?? [],
    knownTradeoffs,
    estimatedRisk: normalizedRisk
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
    "- If the task asks you to create multiple text, Markdown, HTML, SVG, JSON, or source files, prefer JSON key files: [{\"path\":\"relative/path\",\"content\":\"full UTF-8 content\"}] instead of hand-writing a giant unifiedDiff.",
    "- For file-bundle output, include every required output file with its exact relative path and complete text content.",
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
    "Return ONLY one valid JSON object.",
    "Either include unifiedDiff as a non-empty git-style unified diff, or include files: [{path, content}] for generated text files.",
    "If the task creates multiple files, prefer files: [{path, content}] so TomorrowEdge can convert the bundle into a patch safely.",
    "All generated text must be readable valid UTF-8. Do not return mojibake, replacement characters, or garbled Chinese/CJK text.",
    "Do not include markdown fences. Escape newlines inside JSON string values.",
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
    const parsed = livePatchResponseSchema.safeParse(normalizePatchResponseJson(JSON.parse(jsonText)));
    if (!parsed.success) {
      throw new Error(`Live patch response schema mismatch: ${parsed.error.issues.map((issue) => issue.path.join(".") || issue.message).join(", ")}`);
    }
    return parsed.data;
  } catch (firstError) {
    if (jsonText.startsWith("{")) {
      const nestedStart = jsonText.indexOf("{\n");
      if (nestedStart > 0) {
        jsonText = jsonText.slice(nestedStart);
        const parsed = livePatchResponseSchema.safeParse(normalizePatchResponseJson(JSON.parse(jsonText)));
        if (parsed.success) return parsed.data;
      }
    }
  throw firstError;
  }
}

function normalizePatchResponseJson(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const object = { ...(input as Record<string, unknown>) };
  const risk = normalizePatchRiskValue(object.estimatedRisk ?? object.riskLevel ?? object.risk ?? object.riskEstimate);
  if (risk) object.estimatedRisk = risk;
  const generatedFiles = generatedTextFilesFrom(object);
  if (generatedFiles.length) {
    const diff = typeof object.unifiedDiff === "string" ? object.unifiedDiff.trim() : "";
    if (!diff) object.unifiedDiff = unifiedDiffForGeneratedFiles(generatedFiles);
    const existingFiles = Array.isArray(object.filesChanged) ? object.filesChanged.filter((item): item is string => typeof item === "string") : [];
    object.filesChanged = existingFiles.length ? existingFiles : generatedFiles.map((file) => file.path);
  }
  return object;
}

function normalizePatchRiskValue(value: unknown): "low" | "medium" | "high" | undefined {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (["low", "minimal", "minor", "safe", "bounded"].includes(normalized) || normalized.includes("lowrisk")) return "low";
    if (["medium", "moderate", "normal"].includes(normalized) || normalized.includes("mediumrisk") || normalized.includes("moderaterisk")) return "medium";
    if (["high", "severe", "critical", "dangerous"].includes(normalized) || normalized.includes("highrisk") || normalized.includes("criticalrisk")) return "high";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.67) return "high";
    if (value >= 0.34) return "medium";
    if (value >= 0) return "low";
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return normalizePatchRiskValue(record.level ?? record.risk ?? record.estimatedRisk ?? record.value);
  }
  return undefined;
}

type GeneratedTextFile = {
  path: string;
  content: string;
};

function generatedTextFilesFrom(object: Record<string, unknown>): GeneratedTextFile[] {
  for (const key of ["files", "generatedFiles", "fileBundle", "artifacts"]) {
    const files = normalizeGeneratedFileList(object[key]);
    if (files.length) return files;
  }
  return [];
}

function normalizeGeneratedFileList(value: unknown): GeneratedTextFile[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
        const record = item as Record<string, unknown>;
        const pathValue = record.path ?? record.filePath ?? record.filename ?? record.name;
        const contentValue = record.content ?? record.text ?? record.body ?? record.source;
        if (typeof pathValue !== "string" || typeof contentValue !== "string") return undefined;
        const normalizedPath = normalizeGeneratedFilePath(pathValue);
        if (!normalizedPath || !contentValue.trim()) return undefined;
        return { path: normalizedPath, content: contentValue };
      })
      .filter((item): item is GeneratedTextFile => Boolean(item));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([filePath, content]) => {
        if (typeof content !== "string") return undefined;
        const normalizedPath = normalizeGeneratedFilePath(filePath);
        if (!normalizedPath || !content.trim()) return undefined;
        return { path: normalizedPath, content };
      })
      .filter((item): item is GeneratedTextFile => Boolean(item));
  }
  return [];
}

function normalizeGeneratedFilePath(raw: string): string | undefined {
  const normalized = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/[),.;:]+$/g, "");
  if (!normalized || path.isAbsolute(normalized) || normalized.includes("..")) return undefined;
  if (/^(?:node_modules|\.git|\.tomorrowedge|dist|coverage)\//.test(normalized)) return undefined;
  if (/(^|\/)\.env(?:\.|$)/.test(normalized)) return undefined;
  return normalized;
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

function buildDocumentFallbackCandidate(input: LivePatchInput, plan: LivePatchPlan, rawContent: string, reason: string): PatchCandidate | undefined {
  if (!isLongDocumentGenerationTask(input.goal, input.plan.taskType)) return undefined;
  const content = extractDocumentDraft(rawContent);
  if (content.length < 240) return undefined;
  const filePath = preferredDocumentOutputPath(input.goal);
  const unifiedDiff = unifiedDiffForNewFile(filePath, content);
  return {
    candidateId: makeId(`live_${plan.role}_document`),
    agentId: plan.role,
    approach: plan.role === "coder_a" ? "minimal_patch" : "alternative",
    summary: `Recovered document draft as ${filePath} after live patch parsing failed: ${reason}`,
    filesChanged: [filePath],
    unifiedDiff,
    testPlan: documentFallbackTestPlan(filePath, input.plan.verificationCommands),
    knownTradeoffs: [
      "Generated as Markdown fallback because the provider did not return a valid patch JSON response.",
      "HTML/PDF conversion, if requested, should be handled in a follow-up verified step."
    ],
    estimatedRisk: "medium"
  };
}

function isLongDocumentGenerationTask(goal: string, taskType: Plan["taskType"]): boolean {
  return taskType === "docs" || /\b(markdown|document|article|paper|survey|report|html|pdf|latex)\b|论文|综述|文章|文档|报告|参考文献|摘要|关键词/.test(goal.toLowerCase());
}

function extractDocumentDraft(rawContent: string): string {
  const trimmed = rawContent.trim();
  const fenced = /```(?:markdown|md)?\s*([\s\S]*?)```/i.exec(trimmed);
  const content = fenced?.[1]?.trim() || trimmed;
  return content
    .replace(/^\s*Here is (?:the )?(?:markdown|document|article)[^\n]*\n/i, "")
    .trim();
}

function preferredDocumentOutputPath(goal: string): string {
  const explicit = [...goal.matchAll(/(?:^|[\s`"'(:])((?:(?:[A-Za-z0-9_.@()[\]-]+[\\/])+)?[A-Za-z0-9_.@()[\]-]+\.(?:md|markdown|html|htm|txt|rst|adoc))(?:$|[\s`"',.;:)])/gi)]
    .map((match) => normalizeMentionedPath(match[1]))
    .find((value): value is string => Boolean(value));
  if (explicit) return explicit.replace(/\.markdown$/i, ".md");
  const slug = slugFromGoal(goal);
  return `docs/${slug || "generated-document"}.md`;
}

function slugFromGoal(goal: string): string {
  const ascii = goal.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 5).join("-") ?? "";
  if (ascii) return ascii.slice(0, 48);
  return "generated-document";
}

function unifiedDiffForNewFile(filePath: string, content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n?$/, "\n");
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return [
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${Math.max(1, lines.length)} @@`,
    ...lines.map((line) => `+${line}`)
  ].join("\n") + "\n";
}

function unifiedDiffForGeneratedFiles(files: GeneratedTextFile[]): string {
  return files.map((file) => unifiedDiffForNewFile(file.path, file.content)).join("\n");
}

function maybeRecoverDocumentCandidate(
  input: LivePatchInput,
  plan: LivePatchPlan,
  noteBase: ModelNote,
  result: Awaited<ReturnType<typeof chatWithProviderFallback>>,
  parseError: string,
  retryUsed: boolean
): { candidate: PatchCandidate; note: ModelNote } | undefined {
  if (!result.response) return undefined;
  const expectedFiles = expectedTextOutputFiles(input.goal);
  if (expectedFiles.length > 1) return undefined;
  const fallbackCandidate = buildDocumentFallbackCandidate(input, plan, result.response.content, parseError);
  if (!fallbackCandidate) return undefined;
  return {
    candidate: fallbackCandidate,
    note: {
      ...noteBase,
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      fallbackFrom: result.fallbackFrom,
      fallbackReason: result.fallbackReason ?? "document_response_export",
      error: parseError,
      content: `Recovered long-form document content into ${fallbackCandidate.filesChanged.join(", ")} after patch JSON parsing failed.`,
      usage: result.response.usage,
      estimatedCostUsd: estimateCostUsd(result.provider, result.response.usage),
      retryUsed
    }
  };
}

function expectedTextOutputFiles(goal: string): string[] {
  const matches = [...goal.matchAll(/(?:^|[\s`"'(:])((?:(?:[A-Za-z0-9_.@()[\]-]+[\\/])+)?[A-Za-z0-9_.@()[\]-]+\.(?:md|markdown|html|htm|svg|txt|rst|adoc|json|css|js|ts|tsx|jsx|py|rs|go|java|cpp|c|h|hpp|toml|yaml|yml))(?:$|[\s`"',.;:)])/gi)]
    .map((match) => normalizeGeneratedFilePath(match[1]))
    .filter((value): value is string => Boolean(value));
  return [...new Set(matches)];
}

function normalizeGeneratedArtifactRisk(goal: string, risk: PatchCandidate["estimatedRisk"], filesChanged: string[]): PatchCandidate["estimatedRisk"] {
  if (risk !== "high") return risk;
  const expectedFiles = expectedTextOutputFiles(goal);
  if (!expectedFiles.length || !filesChanged.length) return risk;
  const expected = new Set(expectedFiles);
  const boundedToExpectedTextOutputs = filesChanged.every((file) => expected.has(file) && isTextOutputPath(file));
  return boundedToExpectedTextOutputs ? "medium" : risk;
}

function isTextOutputPath(filePath: string): boolean {
  return /\.(?:md|markdown|html|htm|svg|txt|rst|adoc|json|css|js|ts|tsx|jsx|py|rs|go|java|cpp|c|h|hpp|toml|yaml|yml)$/i.test(filePath);
}

function providerRequestTimeoutMs(config: TomorrowEdgeConfig, provider: string): number {
  return config.providers[provider]?.requestTimeoutMs ?? livePatchRequestTimeoutMs;
}

function documentFallbackTestPlan(filePath: string, verificationCommands?: string[]): string[] {
  const commands = (verificationCommands ?? []).filter((command) => command.trim());
  if (commands.length) return commands;
  if (/\.(?:html|htm)$/i.test(filePath)) return [`open ${filePath}`];
  if (/\.(?:md|markdown|txt|rst|adoc)$/i.test(filePath)) return [`inspect ${filePath}`];
  return [`verify generated artifact ${filePath}`];
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
