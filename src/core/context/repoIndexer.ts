import { stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { loadConfig } from "../../config/configLoader.js";
import { classifyFileRisk, type FileRisk } from "../../safety/fileRisk.js";
import { createIgnoreMatcher, normalizePath } from "../../safety/ignoreRules.js";

export type IndexedFile = {
  path: string;
  sizeBytes: number;
  risk: FileRisk;
};

export async function indexRepository(cwd: string): Promise<IndexedFile[]> {
  const config = loadConfig(cwd);
  const matcher = createIgnoreMatcher(cwd, config);
  const files = await fg(["**/*"], {
    cwd,
    dot: true,
    onlyFiles: true,
    ignore: ["node_modules/**", ".git/**", "dist/**"]
  });
  const indexed: IndexedFile[] = [];
  for (const file of files) {
    const normalized = normalizePath(file);
    if (matcher.ignores(normalized)) {
      indexed.push({ path: normalized, sizeBytes: 0, risk: "ignored" });
      continue;
    }
    const fileStat = await stat(path.join(cwd, file));
    indexed.push({
      path: normalized,
      sizeBytes: fileStat.size,
      risk: classifyFileRisk(normalized, fileStat.size)
    });
  }
  return indexed.sort((a, b) => a.path.localeCompare(b.path));
}
