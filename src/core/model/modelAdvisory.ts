import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { ModelNote } from "../../schemas/modelNote.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { Plan } from "../../schemas/plan.js";
import type { ReviewReport } from "../../schemas/review.js";
import type { StructuredVisualSpec } from "../../schemas/visualSpec.js";
import { makeId } from "../../utils/ids.js";
import { ModelRouter } from "../routing/router.js";
import { estimateCostUsd } from "./costAccounting.js";
import { chatWithProviderFallback } from "./providerFallback.js";
import type { EventLedger } from "../events/eventLedger.js";
import type { TaskGovernanceDecision } from "../goal/taskGovernance.js";

const advisoryMaxCompletionTokens = 600;

type AdvisoryCallPlan = {
  role: AgentRole;
  kind: ModelNote["kind"];
  prompt: string;
  provider: string;
  model: string;
  maxOutputTokens: number;
};

export type AdvisoryInput = {
  cwd: string;
  goal: string;
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  plan?: Plan;
  candidates?: PatchCandidate[];
  review?: ReviewReport;
  visualSpec?: StructuredVisualSpec;
  ledger?: EventLedger;
  governance?: TaskGovernanceDecision;
};

export async function runLiveAdvisory(input: AdvisoryInput): Promise<ModelNote[]> {
  const plans = buildAdvisoryPlans(input);
  return Promise.all(plans.map((plan) => runRoleAdvice(input, plan)));
}

export function buildAdvisoryPlans(input: AdvisoryInput): AdvisoryCallPlan[] {
  const governanceRequiresReview = Boolean(input.governance?.requiresReviewer || input.governance?.reasoningSensitivity === "medium" || input.governance?.reasoningSensitivity === "high");
  const governanceRequiresJudge = Boolean(input.governance?.requiresJudge || input.governance?.reasoningSensitivity === "high");
  const roles: Array<{ role: AgentRole; kind: ModelNote["kind"]; prompt: string; enabled: boolean }> = [
    { role: "planner", kind: "plan_advice", prompt: buildPlannerPrompt(input), enabled: true },
    { role: "coder_a", kind: "implementation_advice", prompt: buildCoderPrompt(input), enabled: true },
    { role: "reviewer", kind: "review_advice", prompt: buildReviewerPrompt(input), enabled: Boolean(input.candidates?.length) || governanceRequiresReview },
    { role: "judge", kind: "judge_advice", prompt: buildJudgePrompt(input), enabled: Boolean(input.review) || governanceRequiresJudge }
  ];

  return roles.filter((item) => item.enabled).map((item) => {
    const assignment = input.router.assignmentFor(item.role);
    return {
      role: item.role,
      kind: item.kind,
      prompt: item.prompt,
      provider: assignment.provider,
      model: assignment.model,
      maxOutputTokens: advisoryMaxCompletionTokens
    };
  });
}

async function runRoleAdvice(input: AdvisoryInput, plan: AdvisoryCallPlan): Promise<ModelNote> {
  const base: ModelNote = {
    id: makeId(`note_${plan.role}`),
    role: plan.role,
    provider: plan.provider,
    model: plan.model,
    kind: plan.kind,
    content: ""
  };

  if (plan.provider === "local_tool") {
    return { ...base, error: "Local tool roles do not provide model advice." };
  }

  const result = await chatWithProviderFallback({
    config: input.config,
    router: input.router,
    role: plan.role,
    provider: plan.provider,
    model: plan.model,
    ledger: input.ledger,
    buildRequest: (model) => ({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a coding-agent cockpit advisor. Be concise, concrete, and safety-aware. Do not invent file contents. Return plain text, not markdown tables."
        },
        { role: "user", content: plan.prompt }
      ],
      temperature: 0.2,
      maxCompletionTokens: plan.maxOutputTokens
    })
  });
  if (!result.response) {
    return { ...base, error: result.error, fallbackReason: result.fallbackReason };
  }
  const content = result.response.content.trim();
  return {
    ...base,
    provider: result.provider,
    model: result.model,
    content,
    usage: result.response.usage,
    estimatedCostUsd: estimateCostUsd(result.provider, result.response.usage),
    fallbackUsed: result.fallbackUsed,
    fallbackFrom: result.fallbackFrom,
    fallbackReason: result.fallbackReason,
    error: content ? undefined : "Provider returned an empty advisory response."
  };
}

function buildPlannerPrompt(input: AdvisoryInput): string {
  return [
    `Task: ${input.goal}`,
    `Workspace: ${input.cwd}`,
    governanceLine(input),
    input.visualSpec ? input.visualSpec.handoffPrompt : "",
    "Give a short plan with key risk, expected files, and verification command. Do not propose direct execution."
  ].filter(Boolean).join("\n");
}

function buildReviewerPrompt(input: AdvisoryInput): string {
  const candidates = (input.candidates ?? [])
    .map((candidate) => `${candidate.candidateId}: files=${candidate.filesChanged.join(",") || "none"} summary=${candidate.summary}`)
    .join("\n");
  return [
    `Task: ${input.goal}`,
    `Plan risk: ${input.plan?.riskLevel ?? "unknown"}`,
    governanceLine(input),
    "Candidates:",
    candidates || "(none; this is a reasoning/advisory workflow rather than a patch review)",
    input.candidates?.length
      ? "Give concise review concerns and what a human should inspect before approval."
      : "Independently review the likely answer strategy for correctness risks, missing assumptions, and required verification before the cockpit presents a final answer."
  ].join("\n");
}

function buildCoderPrompt(input: AdvisoryInput): string {
  return [
    `Task: ${input.goal}`,
    `Plan steps: ${(input.plan?.steps ?? []).map((step) => step.title).join(" | ") || "unknown"}`,
    `Expected files: ${(input.plan?.expectedFiles ?? []).join(", ") || "unknown"}`,
    governanceLine(input),
    input.visualSpec ? input.visualSpec.handoffPrompt : "",
    "Suggest a minimal implementation approach and name the first files to inspect. Do not output a patch."
  ].filter(Boolean).join("\n");
}

function buildJudgePrompt(input: AdvisoryInput): string {
  const reviews = (input.review?.reviews ?? [])
    .map((review) => `${review.candidateId}: recommendation=${review.recommendation}, risk=${review.riskScore}, correctness=${review.correctnessScore}`)
    .join("\n");
  return [
    `Task: ${input.goal}`,
    governanceLine(input),
    "Reviews:",
    reviews || "(none; this is a reasoning/advisory workflow rather than a reviewed patch)",
    input.review
      ? "Advise whether judge should select, request revision, or ask user. Explain in one paragraph."
      : "Act as the independent quality gate. State whether a single-model answer is acceptable, what must be checked, and whether a stronger reviewer/judge should be kept in the loop."
  ].join("\n");
}

function governanceLine(input: AdvisoryInput): string {
  if (!input.governance) return "";
  return `Governance: sensitivity=${input.governance.reasoningSensitivity}, reviewer=${input.governance.requiresReviewer}, judge=${input.governance.requiresJudge}, reason=${input.governance.reason}`;
}
