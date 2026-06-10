import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AccessMode } from "../../config/schema.js";
import type { RiskLevel } from "../../schemas/plan.js";
import type { ObjectiveContractV1 } from "../contracts/objectiveContract.js";
import type { ScenarioProfile, ScenarioType } from "../scenarios/scenarioTypes.js";
import { builtinSkillPacks } from "./builtinSkillPacks.js";
import type { SkillManifestV1, SkillPackManifestV1 } from "./skillTypes.js";
import { validateSkillPackManifest } from "./skillTypes.js";

export type SkillRegistryFilter = {
  scenarioType?: ScenarioType;
  accessMode?: AccessMode;
  maxRisk?: RiskLevel;
  requiredTools?: string[];
  lifecycle?: SkillManifestV1["lifecycle"][];
};

export type SkillRegistryLoadResult = {
  registry: SkillRegistry;
  errors: Array<{ source: string; message: string }>;
};

export class SkillRegistry {
  private readonly packs: SkillPackManifestV1[];

  constructor(packs: SkillPackManifestV1[] = builtinSkillPacks()) {
    this.packs = dedupePacks(packs);
  }

  listPacks(): SkillPackManifestV1[] {
    return this.packs.map(clonePack);
  }

  listSkills(filter: SkillRegistryFilter = {}): SkillManifestV1[] {
    return this.packs.flatMap((pack) => pack.skills).filter((skill) => skillMatches(skill, filter)).map(cloneSkill);
  }

  getSkill(skillId: string, version?: string): SkillManifestV1 | undefined {
    const matches = this.packs.flatMap((pack) => pack.skills).filter((skill) => skill.skillId === skillId && (!version || skill.version === version));
    return matches.sort((a, b) => b.version.localeCompare(a.version))[0] ? cloneSkill(matches.sort((a, b) => b.version.localeCompare(a.version))[0]!) : undefined;
  }

  eligibleForScenario(profile: ScenarioProfile, accessMode: AccessMode): SkillManifestV1[] {
    return this.listSkills({
      scenarioType: profile.scenarioType,
      accessMode,
      maxRisk: riskCapFor(profile),
      lifecycle: ["stable", "validated"]
    });
  }

  resolveAllowedTools(contract: ObjectiveContractV1, accessMode: AccessMode): SkillManifestV1[] {
    return this.listSkills({
      scenarioType: contract.scenarioType,
      accessMode,
      maxRisk: contract.riskLevel,
      requiredTools: contract.allowedTools,
      lifecycle: ["stable", "validated"]
    });
  }
}

export async function loadSkillRegistry(cwd: string): Promise<SkillRegistryLoadResult> {
  const project = await loadProjectSkillPacks(cwd);
  return {
    registry: new SkillRegistry([...builtinSkillPacks(), ...project.packs]),
    errors: project.errors
  };
}

export async function loadProjectSkillPacks(cwd: string): Promise<{ packs: SkillPackManifestV1[]; errors: Array<{ source: string; message: string }> }> {
  const root = path.join(cwd, ".tomorrowedge", "skills");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(root, entry.name));
  const packs: SkillPackManifestV1[] = [];
  const errors: Array<{ source: string; message: string }> = [];
  for (const file of files) {
    const text = await readFile(file, "utf8").catch((error: unknown) => {
      errors.push({ source: file, message: error instanceof Error ? error.message : String(error) });
      return "";
    });
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      const validation = validateSkillPackManifest(parsed);
      if (validation.ok) packs.push(validation.pack);
      else errors.push({ source: file, message: validation.errors.map((item) => `${item.path}: ${item.message}`).join("; ") });
    } catch (error) {
      errors.push({ source: file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { packs, errors };
}

export function duplicateSkillKeys(packs: SkillPackManifestV1[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const skill of packs.flatMap((pack) => pack.skills)) {
    const key = `${skill.skillId}@${skill.version}`;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort();
}

function dedupePacks(packs: SkillPackManifestV1[]): SkillPackManifestV1[] {
  const seenPacks = new Set<string>();
  const seenSkills = new Set<string>();
  const next: SkillPackManifestV1[] = [];
  for (const pack of packs) {
    const packKey = `${pack.packId}@${pack.version}`;
    if (seenPacks.has(packKey)) continue;
    seenPacks.add(packKey);
    const skills = pack.skills.filter((skill) => {
      const key = `${skill.skillId}@${skill.version}`;
      if (seenSkills.has(key)) return false;
      seenSkills.add(key);
      return true;
    });
    next.push({ ...pack, skills });
  }
  return next;
}

function skillMatches(skill: SkillManifestV1, filter: SkillRegistryFilter): boolean {
  if (filter.lifecycle?.length && !filter.lifecycle.includes(skill.lifecycle)) return false;
  if (filter.scenarioType && !skill.scenarios.includes(filter.scenarioType) && !skill.scenarios.includes("unknown")) return false;
  if (filter.accessMode && !skill.allowedAccessModes.includes(filter.accessMode)) return false;
  if (filter.maxRisk && riskRank(skill.riskLevel) > riskRank(filter.maxRisk)) return false;
  if (filter.requiredTools?.length) {
    const allowed = new Set(filter.requiredTools);
    if (!skill.requiredTools.some((tool) => allowed.has(tool) || allowed.has(skill.skillId) || allowed.has(tool.split(".")[0] ?? tool))) return false;
  }
  return true;
}

function riskCapFor(profile: ScenarioProfile): RiskLevel {
  if (profile.riskSignals.some((signal) => signal.includes("security") || signal.includes("production"))) return "high";
  if (profile.riskSignals.length || profile.ambiguityLevel === "medium") return "medium";
  return "medium";
}

function riskRank(risk: RiskLevel): number {
  return risk === "high" ? 3 : risk === "medium" ? 2 : 1;
}

function clonePack(pack: SkillPackManifestV1): SkillPackManifestV1 {
  return { ...pack, domainTags: [...pack.domainTags], userStories: [...pack.userStories], skills: pack.skills.map(cloneSkill) };
}

function cloneSkill(skill: SkillManifestV1): SkillManifestV1 {
  return {
    ...skill,
    tags: [...skill.tags],
    scenarios: [...skill.scenarios],
    userStories: [...skill.userStories],
    inputs: [...skill.inputs],
    outputs: [...skill.outputs],
    requiredArtifacts: [...skill.requiredArtifacts],
    verificationCommands: [...skill.verificationCommands],
    requiredTools: [...skill.requiredTools],
    allowedAccessModes: [...skill.allowedAccessModes],
    permissions: {
      intents: [...skill.permissions.intents],
      allowedTools: [...skill.permissions.allowedTools],
      filesystem: { ...skill.permissions.filesystem },
      shell: { ...skill.permissions.shell, commands: [...skill.permissions.shell.commands] },
      network: { ...skill.permissions.network, hosts: [...skill.permissions.network.hosts] },
      github: { ...skill.permissions.github }
    },
    fixtures: skill.fixtures.map((fixture) => ({ ...fixture, commands: [...fixture.commands] })),
    sandbox: { ...skill.sandbox },
    lifecycleHistory: skill.lifecycleHistory.map((item) => ({ ...item, evidenceRefs: [...item.evidenceRefs] }))
  };
}
