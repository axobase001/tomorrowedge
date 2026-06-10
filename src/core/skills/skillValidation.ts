import { createHash } from "node:crypto";
import type { AccessMode } from "../../config/schema.js";
import type { ObjectiveContractV1 } from "../contracts/objectiveContract.js";
import type { SkillManifestV1 } from "./skillTypes.js";
import { validateSkillManifest } from "./skillTypes.js";

export type SkillSandboxProfile = {
  mode: "fixture" | "isolated_workspace";
  fixtureId?: string;
};

export type SkillValidationReport = {
  schemaVersion: "skill-validation-report/v1";
  reportId: string;
  skillId: string;
  skillVersion: string;
  status: "passed" | "failed" | "blocked";
  sandboxProfile: SkillSandboxProfile;
  checkedAt: string;
  blockingConcerns: string[];
  warnings: string[];
  requiredHumanDecisions: string[];
  artifactRefs: string[];
  manifestHash: string;
};

export type SkillValidationInput = {
  candidate: unknown;
  existingSkills?: SkillManifestV1[];
  contract?: ObjectiveContractV1;
  accessMode?: AccessMode;
  sandboxProfile?: SkillSandboxProfile;
  artifactRefs?: string[];
  now?: string;
};

export function validateSkillCandidate(input: SkillValidationInput): SkillValidationReport {
  const parsed = validateSkillManifest(input.candidate);
  if (!parsed.ok) {
    return reportForInvalidManifest(input, parsed.errors.map((item) => `${item.path}: ${item.message}`));
  }
  const skill = parsed.manifest;
  const blockingConcerns = [
    ...duplicateConcerns(skill, input.existingSkills ?? []),
    ...permissionConcerns(skill, input.accessMode ?? "restricted"),
    ...contractConcerns(skill, input.contract),
    ...sandboxConcerns(skill, input.sandboxProfile)
  ];
  const warnings = warningsFor(skill);
  return {
    schemaVersion: "skill-validation-report/v1",
    reportId: validationReportId(skill),
    skillId: skill.skillId,
    skillVersion: skill.version,
    status: blockingConcerns.length ? "blocked" : "passed",
    sandboxProfile: input.sandboxProfile ?? { mode: "fixture", fixtureId: skill.fixtures[0]?.id },
    checkedAt: input.now ?? new Date().toISOString(),
    blockingConcerns,
    warnings,
    requiredHumanDecisions: skill.provenance === "agent_candidate" ? ["operator approval before promotion"] : [],
    artifactRefs: input.artifactRefs ?? [],
    manifestHash: manifestHash(skill)
  };
}

function reportForInvalidManifest(input: SkillValidationInput, blockingConcerns: string[]): SkillValidationReport {
  return {
    schemaVersion: "skill-validation-report/v1",
    reportId: `skill_validation_${hashText(JSON.stringify(blockingConcerns)).slice(0, 12)}`,
    skillId: "invalid",
    skillVersion: "0.0.0",
    status: "failed",
    sandboxProfile: input.sandboxProfile ?? { mode: "fixture" },
    checkedAt: input.now ?? new Date().toISOString(),
    blockingConcerns,
    warnings: [],
    requiredHumanDecisions: [],
    artifactRefs: input.artifactRefs ?? [],
    manifestHash: hashText(JSON.stringify(input.candidate))
  };
}

function duplicateConcerns(skill: SkillManifestV1, existingSkills: SkillManifestV1[]): string[] {
  return existingSkills.some((existing) => existing.skillId === skill.skillId && existing.version === skill.version)
    ? [`duplicate skill version: ${skill.skillId}@${skill.version}`]
    : [];
}

function permissionConcerns(skill: SkillManifestV1, accessMode: AccessMode): string[] {
  const concerns: string[] = [];
  if (!skill.allowedAccessModes.includes(accessMode)) concerns.push(`access mode ${accessMode} is not allowed`);
  if (accessMode === "restricted" && (skill.permissions.filesystem.write || skill.permissions.shell.allowed || skill.permissions.network.allowed || skill.permissions.intents.includes("database") || skill.permissions.github.write)) {
    concerns.push("restricted mode cannot validate write, shell, network, database, or GitHub write skills");
  }
  if (skill.permissions.shell.allowed && !skill.verificationCommands.length && !skill.permissions.shell.commands.length) {
    concerns.push("shell permission requires declared verification or allowed commands");
  }
  if (skill.permissions.network.allowed) concerns.push("network permission is not allowed for generated skills in v1");
  if (skill.permissions.github.write && !skill.requiredTools.includes("github")) concerns.push("GitHub write permission requires the github tool declaration");
  return concerns;
}

function contractConcerns(skill: SkillManifestV1, contract?: ObjectiveContractV1): string[] {
  if (!contract) return [];
  const allowed = new Set(contract.allowedTools);
  const missing = skill.requiredTools.filter((tool) => !allowed.has(tool) && !allowed.has(skill.skillId) && !allowed.has(tool.split(".")[0] ?? tool));
  return missing.length ? [`contract does not allow required tools: ${missing.join(", ")}`] : [];
}

function sandboxConcerns(skill: SkillManifestV1, sandboxProfile?: SkillSandboxProfile): string[] {
  if (!skill.sandbox.required) return [];
  if (!sandboxProfile && !skill.fixtures.length) return ["sandbox validation requires a fixture or isolated workspace profile"];
  return [];
}

function warningsFor(skill: SkillManifestV1): string[] {
  const warnings: string[] = [];
  if (!skill.requiredArtifacts.length) warnings.push("no required artifacts declared");
  if (skill.lifecycle !== "candidate" && skill.provenance === "agent_candidate") warnings.push("agent candidate should start in candidate lifecycle state");
  return warnings;
}

function validationReportId(skill: SkillManifestV1): string {
  return `skill_validation_${hashText(`${skill.skillId}@${skill.version}:${skill.lifecycle}`).slice(0, 12)}`;
}

function manifestHash(skill: SkillManifestV1): string {
  return hashText(JSON.stringify(skill));
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
