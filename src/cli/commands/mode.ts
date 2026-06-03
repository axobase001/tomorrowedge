import { loadConfig, writeConfig } from "../../config/configLoader.js";
import { accessModeSchema, type AccessMode } from "../../config/schema.js";
import { loadProjectPreferences, saveProjectPreferences } from "../../core/memory/preferences.js";

export async function modeCommand(cwd: string, mode?: string): Promise<void> {
  const config = loadConfig(cwd);
  const prefs = loadProjectPreferences(cwd);
  if (!mode) {
    process.stdout.write(`access_mode: ${config.project.access_mode}\n`);
    if (prefs.accessMode) process.stdout.write(`preferred access_mode: ${prefs.accessMode}\n`);
    process.stdout.write("available: restricted, partial, full\n");
    return;
  }

  const parsed = accessModeSchema.safeParse(mode);
  if (!parsed.success) {
    throw new Error(`Invalid access mode: ${mode}. Use restricted, partial, or full.`);
  }

  const next = {
    ...config,
    project: {
      ...config.project,
      access_mode: parsed.data as AccessMode
    }
  };
  const path = await writeConfig(cwd, next);
  const prefsPath = await saveProjectPreferences(cwd, { ...prefs, accessMode: parsed.data as AccessMode });
  process.stdout.write(`access_mode set to ${parsed.data}\n`);
  if (parsed.data === "full") {
    process.stderr.write("Warning: FULL AUTONOMY auto-approves patch, shell, and repair actions. Use it in a clean repo, sandbox, or fixture.\n");
  }
  process.stdout.write(`updated ${path}\n`);
  process.stdout.write(`updated ${prefsPath}\n`);
}
