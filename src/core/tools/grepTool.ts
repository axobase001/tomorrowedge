import { readFile } from "node:fs/promises";
import path from "node:path";
import { indexRepository } from "../context/repoIndexer.js";

export type GrepHit = {
  path: string;
  line: number;
  text: string;
};

export async function grepProject(cwd: string, pattern: RegExp, limit = 100): Promise<GrepHit[]> {
  const hits: GrepHit[] = [];
  const files = (await indexRepository(cwd)).filter((file) => file.risk === "safe");
  for (const file of files) {
    if (hits.length >= limit) break;
    const content = await readFile(path.join(cwd, file.path), "utf8").catch(() => "");
    content.split(/\r?\n/).forEach((lineText, index) => {
      if (hits.length < limit && pattern.test(lineText)) {
        hits.push({ path: file.path, line: index + 1, text: lineText.trim() });
      }
    });
  }
  return hits;
}
