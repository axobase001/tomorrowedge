import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ignore from "ignore";
import type { TomorrowEdgeConfig } from "../config/schema.js";

export function createIgnoreMatcher(cwd: string, config: TomorrowEdgeConfig) {
  const matcher = ignore();
  matcher.add(config.safety.exclude);
  for (const fileName of [".gitignore", ".tomorrowedgeignore"]) {
    const filePath = path.join(cwd, fileName);
    if (existsSync(filePath)) matcher.add(readFileSync(filePath, "utf8"));
  }
  return {
    ignores(relativePath: string): boolean {
      return matcher.ignores(normalizePath(relativePath));
    }
  };
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
