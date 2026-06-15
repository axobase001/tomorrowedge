import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type EvidenceArtifactRecord = {
  path: string;
  kind: "json" | "log" | "text";
  description: string;
};

export async function writeEvidenceJson(evidenceDir: string, fileName: string, value: unknown, description: string): Promise<EvidenceArtifactRecord> {
  await mkdir(evidenceDir, { recursive: true });
  const target = path.join(evidenceDir, fileName);
  await writeFile(target, JSON.stringify(value, null, 2), "utf8");
  return {
    path: target,
    kind: "json",
    description
  };
}

export async function writeEvidenceText(evidenceDir: string, fileName: string, value: string, description: string): Promise<EvidenceArtifactRecord> {
  await mkdir(evidenceDir, { recursive: true });
  const target = path.join(evidenceDir, fileName);
  await writeFile(target, value, "utf8");
  return {
    path: target,
    kind: "text",
    description
  };
}
