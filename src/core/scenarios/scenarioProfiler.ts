import type { AccessMode } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { WorkflowIntentDecision } from "../goal/workflowIntent.js";
import type { WorkflowKind } from "../orchestration/workflowKind.js";
import type { ScenarioProfile, ScenarioType } from "./scenarioTypes.js";

export type ScenarioProfilerInput = {
  goal: string;
  workflowIntent?: Pick<WorkflowIntentDecision, "intent" | "requiresPatchWorkflow" | "workflowKind">;
  accessMode?: AccessMode;
  hasImageInputs?: boolean;
};

export function profileScenario(input: ScenarioProfilerInput): ScenarioProfile {
  const text = normalize(input.goal);
  const scenarioType = inferScenarioType(text, input);
  const likelyWorkflowKind = inferWorkflowKind(text, scenarioType, input);
  const riskSignals = inferRiskSignals(text, input);
  const ambiguityLevel = inferAmbiguityLevel(text, input, riskSignals);
  const evidenceNeeds = inferEvidenceNeeds(scenarioType, likelyWorkflowKind, riskSignals);
  const suggestedRoles = inferSuggestedRoles(likelyWorkflowKind, riskSignals);
  return {
    scenarioType,
    userIntent: inferUserIntent(scenarioType, input.goal, likelyWorkflowKind),
    expectedDeliverable: expectedDeliverable(scenarioType, likelyWorkflowKind),
    ambiguityLevel,
    likelyWorkflowKind,
    riskSignals,
    evidenceNeeds,
    suggestedRoles
  };
}

function inferScenarioType(text: string, input: ScenarioProfilerInput): ScenarioType {
  if (input.hasImageInputs) return "coding";
  if (/\b(refactor|cleanup|rewrite|restructure|modularize)\b|\u91cd\u6784|\u6574\u7406/.test(text)) return "refactor";
  if (/\b(fix|bug|failing|error|crash|repair|debug)\b|\u4fee\u590d|\u62a5\u9519|\u9519\u8bef/.test(text)) return "debugging";
  if (/\b(implement|add|build|create|write code|component|api|feature)\b|\u5b9e\u73b0|\u65b0\u589e|\u6dfb\u52a0|\u521b\u5efa/.test(text)) return "coding";
  if (/\b(readme|doc|document|proposal|report|markdown|copywriting)\b|\u6587\u6863|\u62a5\u544a|\u4ecb\u7ecd/.test(text)) return "document";
  if (/\b(research|survey|paper|citation|literature|benchmark analysis)\b|\u8bba\u6587|\u7814\u7a76|\u6587\u732e/.test(text)) return "research";
  if (/\b(plan|scope|roadmap|strategy|design review|architecture)\b|\u8ba1\u5212|\u8def\u7ebf|\u67b6\u6784/.test(text)) return "planning";
  if (/\b(deploy|release|package|ci|server|process|port|env|ops)\b|\u53d1\u5e03|\u90e8\u7f72|\u6253\u5305/.test(text)) return "ops";
  if (input.workflowIntent?.requiresPatchWorkflow === false) return "analysis";
  return input.workflowIntent?.requiresPatchWorkflow ? "coding" : "unknown";
}

function inferWorkflowKind(text: string, scenarioType: ScenarioType, input: ScenarioProfilerInput): WorkflowKind {
  if (input.workflowIntent?.workflowKind) return input.workflowIntent.workflowKind;
  if (input.hasImageInputs) return "vision_patch";
  if (scenarioType === "analysis" || scenarioType === "research" || scenarioType === "planning") return "read_only";
  if (scenarioType === "document" && /\b(edit|write|update|create|add)\b|\u5199|\u66f4\u65b0|\u521b\u5efa/.test(text)) return "patch";
  if (scenarioType === "debugging") return "patch";
  if (scenarioType === "refactor") return "patch";
  if (scenarioType === "coding") return "patch";
  return input.workflowIntent?.requiresPatchWorkflow ? "patch" : "read_only";
}

function inferRiskSignals(text: string, input: ScenarioProfilerInput): string[] {
  const signals: string[] = [];
  if (/\b(auth|permission|secret|token|credential|password|payment|security|crypto)\b|\u6743\u9650|\u5bc6\u7801|\u652f\u4ed8|\u5b89\u5168/.test(text)) signals.push("security_sensitive");
  if (/\b(database|migration|delete|drop|production|release|deploy)\b|\u6570\u636e\u5e93|\u5220\u9664|\u751f\u4ea7|\u53d1\u5e03/.test(text)) signals.push("irreversible_or_production");
  if (/\b(prove|formal|theorem|math|correctness|benchmark claim)\b|\u8bc1\u660e|\u5b9a\u7406|\u6b63\u786e\u6027/.test(text)) signals.push("correctness_critical");
  if (input.accessMode === "full") signals.push("full_access");
  return signals;
}

function inferAmbiguityLevel(text: string, input: ScenarioProfilerInput, riskSignals: string[]): ScenarioProfile["ambiguityLevel"] {
  if (input.workflowIntent?.intent === "ask_user") return "high";
  if (/\b(maybe|not sure|roughly|whatever|you decide|看看|随便|大概)\b/.test(text)) return "medium";
  if (riskSignals.length >= 2 && text.length < 60) return "medium";
  return "low";
}

function inferEvidenceNeeds(scenarioType: ScenarioType, workflowKind: WorkflowKind, riskSignals: string[]): string[] {
  const needs = new Set<string>(["objective contract", "event ledger"]);
  if (workflowKind === "patch" || workflowKind === "vision_patch" || workflowKind === "repair") {
    needs.add("candidate patch diff");
    needs.add("review decision");
    needs.add("judge decision");
    needs.add("verification result");
  }
  if (scenarioType === "research") needs.add("cited or inspectable evidence");
  if (scenarioType === "document") needs.add("changed document or generated artifact");
  if (riskSignals.length) {
    needs.add("risk assessment");
    needs.add("independent review");
  }
  return [...needs];
}

function inferSuggestedRoles(workflowKind: WorkflowKind, riskSignals: string[]): AgentRole[] {
  const roles: AgentRole[] = workflowKind === "read_only" || workflowKind === "advisory"
    ? ["planner", "explorer", "summarizer"]
    : ["planner", "explorer", "coder_a", "reviewer", "judge", "runner", "summarizer"];
  if (workflowKind === "vision_patch") roles.unshift("vision");
  if (riskSignals.length && !roles.includes("judge")) roles.splice(Math.max(roles.length - 1, 0), 0, "reviewer", "judge");
  return [...new Set(roles)];
}

function inferUserIntent(scenarioType: ScenarioType, goal: string, workflowKind: WorkflowKind): string {
  const suffix = workflowKind === "read_only" || workflowKind === "advisory" ? "without mutating files" : "with auditable engineering evidence";
  return `${scenarioType} task: ${clip(goal, 120)} (${suffix})`;
}

function expectedDeliverable(scenarioType: ScenarioType, workflowKind: WorkflowKind): string {
  if (workflowKind === "patch" || workflowKind === "vision_patch" || workflowKind === "repair") return "patch candidate, review/judge decision, verification evidence, and final summary";
  if (scenarioType === "research") return "structured analysis with inspectable evidence";
  if (scenarioType === "document") return "document or artifact update with summary";
  if (scenarioType === "planning") return "scope, plan, risks, and next steps";
  return "read-only diagnosis or answer with evidence";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

