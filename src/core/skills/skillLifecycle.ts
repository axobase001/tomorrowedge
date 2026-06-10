import type { SkillLifecycleState, SkillManifestV1 } from "./skillTypes.js";

export type SkillLifecycleTransition =
  | "submit_candidate"
  | "validate"
  | "promote"
  | "reject"
  | "deprecate"
  | "block"
  | "rollback";

export type SkillLifecycleTransitionInput = {
  transition: SkillLifecycleTransition;
  actor: string;
  reason: string;
  evidenceRefs?: string[];
  validationReportId?: string;
  previousVersion?: string;
  now?: string;
};

export function transitionSkillLifecycle(skill: SkillManifestV1, input: SkillLifecycleTransitionInput): SkillManifestV1 {
  const to = nextState(skill.lifecycle, input);
  const next: SkillManifestV1 = {
    ...skill,
    lifecycle: to,
    validationReportId: input.validationReportId ?? skill.validationReportId,
    previousVersion: input.previousVersion ?? skill.previousVersion,
    rollbackToVersion: input.transition === "rollback" ? input.previousVersion ?? skill.previousVersion : skill.rollbackToVersion,
    lifecycleHistory: [
      ...skill.lifecycleHistory,
      {
        from: skill.lifecycle,
        to,
        reason: input.reason,
        actor: input.actor,
        evidenceRefs: input.evidenceRefs ?? [],
        at: input.now ?? new Date().toISOString()
      }
    ]
  };
  return next;
}

function nextState(current: SkillLifecycleState, input: SkillLifecycleTransitionInput): SkillLifecycleState {
  if (input.transition === "submit_candidate" && current === "draft") return "candidate";
  if (input.transition === "validate" && (current === "draft" || current === "candidate")) {
    if (!input.validationReportId) throw new Error("Skill validation requires validationReportId.");
    return "validated";
  }
  if (input.transition === "promote" && current === "validated") {
    if (!input.validationReportId) throw new Error("Skill promotion requires validationReportId.");
    return "stable";
  }
  if (input.transition === "reject" && (current === "draft" || current === "candidate" || current === "validated")) return "rejected";
  if (input.transition === "deprecate" && current === "stable") return "deprecated";
  if (input.transition === "block") return "blocked";
  if (input.transition === "rollback" && (current === "stable" || current === "deprecated" || current === "blocked")) {
    if (!input.previousVersion) throw new Error("Skill rollback requires previousVersion.");
    return "rolled_back";
  }
  throw new Error(`Invalid skill lifecycle transition: ${current} -> ${input.transition}.`);
}
