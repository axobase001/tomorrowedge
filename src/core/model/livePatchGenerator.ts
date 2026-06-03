import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { Plan } from "../../schemas/plan.js";
import { makeId } from "../../utils/ids.js";
import type { ContextSelection } from "../context/fileSelector.js";
import { estimateCostUsd } from "./costAccounting.js";
import type { ModelRouter } from "../routing/router.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { ModelNote } from "../../schemas/modelNote.js";
import type { StructuredVisualSpec } from "../../schemas/visualSpec.js";
import { chatWithProviderFallback } from "./providerFallback.js";

const maxPatchCompletionTokens = 2200;
const maxFileChars = 2400;
const maxContextFiles = 8;

export type LivePatchInput = {
  cwd: string;
  goal: string;
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  plan: Plan;
  contextSelection: ContextSelection;
  visualSpec?: StructuredVisualSpec;
};

export type LivePatchPlan = {
  role: "coder_a" | "coder_b";
  provider: string;
  model: string;
  prompt: string;
  maxOutputTokens: number;
};

export async function buildLivePatchPlans(input: LivePatchInput): Promise<LivePatchPlan[]> {
  const roles: Array<"coder_a" | "coder_b"> = ["coder_a", "coder_b"];
  const context = await buildPatchContext(input.cwd, input.contextSelection, input.config.privacy.allow_cloud_repo_context);
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

  const result = await chatWithProviderFallback({
    config: input.config,
    router: input.router,
    role: plan.role,
    provider: plan.provider,
    model: plan.model,
    buildRequest: (model) => ({
      model,
      messages: [
        {
          role: "system",
          content:
            "You generate conservative code patches. Return ONLY JSON with keys summary, unifiedDiff, filesChanged, testPlan, knownTradeoffs, estimatedRisk. unifiedDiff must be a standard git-style unified diff. Do not use markdown fences."
        },
        { role: "user", content: plan.prompt }
      ],
      temperature: plan.role === "coder_a" ? 0.15 : 0.35,
      maxCompletionTokens: plan.maxOutputTokens
    })
  });
  if (!result.response) {
    const message = result.error ?? "Live patch provider failed.";
    return {
      candidate: emptyCandidate(plan.role, message, input.plan),
      note: { ...noteBase, error: message, fallbackReason: result.fallbackReason }
    };
  }

  try {
    const parsed = parsePatchJson(result.response.content);
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
        fallbackReason: result.fallbackReason,
        error: candidate.unifiedDiff.trim() ? undefined : "Live patch response did not contain a usable unified diff."
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      candidate: emptyCandidate(plan.role, message, input.plan),
      note: {
        ...noteBase,
        provider: result.provider,
        model: result.model,
        fallbackUsed: result.fallbackUsed,
        fallbackFrom: result.fallbackFrom,
        fallbackReason: result.fallbackReason,
        error: message
      }
    };
  }
}

async function buildPatchContext(cwd: string, contextSelection: ContextSelection, allowCloudRepoContext: boolean): Promise<string> {
  const chunks: string[] = [];
  for (const file of contextSelection.selectedFiles.filter((item) => item.risk === "safe").slice(0, maxContextFiles)) {
    if (!allowCloudRepoContext) {
      chunks.push(`FILE: ${file.path}\nCONTENT: omitted because privacy.allow_cloud_repo_context=false\nREASON: ${file.reason}`);
      continue;
    }
    const absolute = path.join(cwd, file.path);
    const content = await readFile(absolute, "utf8").catch(() => "");
    chunks.push(`FILE: ${file.path}\n${content.slice(0, maxFileChars)}`);
  }
  return chunks.join("\n\n---\n\n");
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
    "- If no safe patch can be produced, return an empty unifiedDiff and explain why in summary.",
    input.visualSpec ? "Structured visual spec:" : "",
    input.visualSpec?.handoffPrompt ?? "",
    "Context:",
    context || "No safe context files were selected."
  ].filter(Boolean).join("\n");
}

function parsePatchJson(raw: string): {
  summary: string;
  unifiedDiff: string;
  filesChanged: string[];
  testPlan: string[];
  knownTradeoffs: string[];
  estimatedRisk: "low" | "medium" | "high";
} {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Live patch response was not JSON.");
  const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<{
    summary: string;
    unifiedDiff: string;
    filesChanged: string[];
    testPlan: string[];
    knownTradeoffs: string[];
    estimatedRisk: "low" | "medium" | "high";
  }>;
  return {
    summary: parsed.summary ?? "",
    unifiedDiff: parsed.unifiedDiff ?? "",
    filesChanged: Array.isArray(parsed.filesChanged) ? parsed.filesChanged : [],
    testPlan: Array.isArray(parsed.testPlan) ? parsed.testPlan : [],
    knownTradeoffs: Array.isArray(parsed.knownTradeoffs) ? parsed.knownTradeoffs : [],
    estimatedRisk: parsed.estimatedRisk === "medium" || parsed.estimatedRisk === "high" ? parsed.estimatedRisk : "low"
  };
}

function inferFilesFromDiff(diff: string): string[] {
  return [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]).filter(Boolean);
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
