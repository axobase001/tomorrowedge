import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CandidateSkillProposalV1 } from "./skillProposal.js";

export async function readCandidateSkillProposals(cwd: string): Promise<CandidateSkillProposalV1[]> {
  const text = await readFile(candidateFile(cwd), "utf8").catch(() => "");
  if (!text) return [];
  return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as CandidateSkillProposalV1;
      return parsed.schemaVersion === "candidate-skill/v1" ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

export async function writeCandidateSkillProposals(cwd: string, proposals: CandidateSkillProposalV1[]): Promise<void> {
  const existing = await readCandidateSkillProposals(cwd);
  const byKey = new Map<string, CandidateSkillProposalV1>();
  for (const item of [...existing, ...proposals]) byKey.set(item.duplicateKey, item);
  await mkdir(path.dirname(candidateFile(cwd)), { recursive: true });
  await writeFile(candidateFile(cwd), [...byKey.values()].map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
}

function candidateFile(cwd: string): string {
  return path.join(cwd, ".tomorrowedge", "candidate-skills.jsonl");
}
