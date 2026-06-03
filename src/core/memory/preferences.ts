import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AccessMode, RoutingMode } from "../../config/schema.js";

export type ProjectPreferences = {
  accessMode?: AccessMode;
  routingMode?: RoutingMode;
  preferredTestCommand?: string;
  preferredLivePatch?: boolean;
  preferredLiveAdvisory?: boolean;
};

export const emptyProjectPreferences: ProjectPreferences = {};

export function loadProjectPreferences(cwd: string): ProjectPreferences {
  const filePath = preferencesPath(cwd);
  if (!existsSync(filePath)) return emptyProjectPreferences;
  return JSON.parse(readFileSync(filePath, "utf8")) as ProjectPreferences;
}

export async function saveProjectPreferences(cwd: string, preferences: ProjectPreferences): Promise<string> {
  const dir = path.join(cwd, ".tomorrowedge");
  await mkdir(dir, { recursive: true });
  const filePath = preferencesPath(cwd);
  await writeFile(filePath, JSON.stringify(preferences, null, 2), "utf8");
  return filePath;
}

function preferencesPath(cwd: string): string {
  return path.join(cwd, ".tomorrowedge", "preferences.json");
}
