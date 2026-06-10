import { readFile } from "node:fs/promises";
import { loadSkillRegistry } from "../../core/skills/skillRegistry.js";
import { proposeCandidateSkillsFromTraces } from "../../core/skills/skillProposal.js";
import { readCandidateSkillProposals, writeCandidateSkillProposals } from "../../core/skills/skillCandidateStore.js";
import { validateSkillCandidate } from "../../core/skills/skillValidation.js";
import { readTraces } from "../../core/traces/traceStore.js";

export async function skillsListCommand(cwd: string, options: { json?: boolean; scenario?: string; accessMode?: "restricted" | "partial" | "full" }): Promise<void> {
  const loaded = await loadSkillRegistry(cwd);
  const skills = loaded.registry.listSkills({
    scenarioType: options.scenario as never,
    accessMode: options.accessMode,
    lifecycle: ["stable", "validated", "candidate"]
  });
  if (options.json) {
    console.log(JSON.stringify({ skills, errors: loaded.errors }, null, 2));
    return;
  }
  for (const skill of skills) {
    console.log(`${skill.skillId}@${skill.version} ${skill.lifecycle} ${skill.riskLevel} [${skill.allowedAccessModes.join(",")}]`);
    console.log(`  ${skill.description}`);
  }
  if (loaded.errors.length) {
    console.log("\nRegistry warnings:");
    for (const error of loaded.errors) console.log(`- ${error.source}: ${error.message}`);
  }
}

export async function skillsPacksCommand(cwd: string, options: { json?: boolean }): Promise<void> {
  const loaded = await loadSkillRegistry(cwd);
  const packs = loaded.registry.listPacks();
  if (options.json) {
    console.log(JSON.stringify({ packs, errors: loaded.errors }, null, 2));
    return;
  }
  for (const pack of packs) {
    console.log(`${pack.packId}@${pack.version} ${pack.kind} skills=${pack.skills.length}`);
    console.log(`  ${pack.description}`);
  }
}

export async function skillsInspectCommand(cwd: string, skillId: string, options: { json?: boolean; version?: string }): Promise<void> {
  const loaded = await loadSkillRegistry(cwd);
  const skill = loaded.registry.getSkill(skillId, options.version);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);
  if (options.json) {
    console.log(JSON.stringify(skill, null, 2));
    return;
  }
  console.log(`${skill.skillId}@${skill.version}`);
  console.log(`state: ${skill.lifecycle}`);
  console.log(`risk: ${skill.riskLevel}`);
  console.log(`provenance: ${skill.provenance}`);
  console.log(`tools: ${skill.requiredTools.join(", ") || "-"}`);
  console.log(`access: ${skill.allowedAccessModes.join(", ")}`);
  console.log(`description: ${skill.description}`);
  if (skill.lifecycleHistory.length) {
    console.log("history:");
    for (const item of skill.lifecycleHistory) console.log(`- ${item.at} ${item.from ?? "-"} -> ${item.to}: ${item.reason}`);
  }
}

export async function skillsProposeCommand(cwd: string, options: { json?: boolean; write?: boolean; minSupport?: string }): Promise<void> {
  const traces = await readTraces(cwd, { limit: 200, newestFirst: true });
  const registry = await loadSkillRegistry(cwd);
  const existingSkillIds = registry.registry.listSkills().map((skill) => skill.skillId);
  const proposals = proposeCandidateSkillsFromTraces(traces, {
    minSupport: Number.parseInt(options.minSupport ?? "2", 10),
    existingSkillIds
  });
  if (options.write) await writeCandidateSkillProposals(cwd, proposals);
  if (options.json) {
    console.log(JSON.stringify({ proposals, written: Boolean(options.write) }, null, 2));
    return;
  }
  console.log(`${proposals.length} candidate skill proposal(s)${options.write ? " written" : ""}.`);
  for (const proposal of proposals) {
    console.log(`- ${proposal.proposalId} ${proposal.status} confidence=${proposal.confidence}: ${proposal.reason}`);
  }
}

export async function skillsCandidatesCommand(cwd: string, options: { json?: boolean }): Promise<void> {
  const proposals = await readCandidateSkillProposals(cwd);
  if (options.json) {
    console.log(JSON.stringify(proposals, null, 2));
    return;
  }
  for (const proposal of proposals) {
    console.log(`${proposal.proposalId} ${proposal.status} ${proposal.proposedSkill.skillId}@${proposal.proposedSkill.version}`);
    console.log(`  traces: ${proposal.sourceTraceIds.join(", ")}`);
  }
}

export async function skillsValidateCommand(cwd: string, manifestPath: string, options: { json?: boolean; accessMode?: "restricted" | "partial" | "full" }): Promise<void> {
  const text = await readFile(manifestPath, "utf8");
  const candidate = JSON.parse(text);
  const registry = await loadSkillRegistry(cwd);
  const report = validateSkillCandidate({
    candidate,
    existingSkills: registry.registry.listSkills(),
    accessMode: options.accessMode ?? "restricted",
    sandboxProfile: { mode: "fixture" }
  });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`${report.reportId} ${report.status}`);
  for (const concern of report.blockingConcerns) console.log(`- BLOCKED: ${concern}`);
  for (const warning of report.warnings) console.log(`- WARN: ${warning}`);
}
