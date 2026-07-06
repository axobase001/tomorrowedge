import { mkdir } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../persistence/atomicWrite.js";

export type EvidenceArtifactRecord = {
  path: string;
  kind: "json" | "log" | "text";
  description: string;
};

export async function writeEvidenceJson(evidenceDir: string, fileName: string, value: unknown, description: string): Promise<EvidenceArtifactRecord> {
  await mkdir(evidenceDir, { recursive: true });
  const target = path.join(evidenceDir, fileName);
  await writeFileAtomic(target, JSON.stringify(value, null, 2));
  return {
    path: target,
    kind: "json",
    description
  };
}

export async function writeEvidenceText(evidenceDir: string, fileName: string, value: string, description: string): Promise<EvidenceArtifactRecord> {
  await mkdir(evidenceDir, { recursive: true });
  const target = path.join(evidenceDir, fileName);
  await writeFileAtomic(target, value);
  return {
    path: target,
    kind: "text",
    description
  };
}
