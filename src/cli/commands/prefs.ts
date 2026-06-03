import { accessModeSchema, routingModeSchema } from "../../config/schema.js";
import { loadProjectPreferences, saveProjectPreferences, type ProjectPreferences } from "../../core/memory/preferences.js";

export type PrefsOptions = {
  accessMode?: string;
  routingMode?: string;
  testCommand?: string;
  livePatch?: boolean;
  liveAdvisory?: boolean;
};

export async function prefsCommand(cwd: string, options: PrefsOptions = {}): Promise<void> {
  const current = loadProjectPreferences(cwd);
  const updates: ProjectPreferences = {};

  if (options.accessMode !== undefined) {
    const parsed = accessModeSchema.safeParse(options.accessMode);
    if (!parsed.success) throw new Error(`Invalid access mode: ${options.accessMode}`);
    updates.accessMode = parsed.data;
  }
  if (options.routingMode !== undefined) {
    const parsed = routingModeSchema.safeParse(options.routingMode);
    if (!parsed.success) throw new Error(`Invalid routing mode: ${options.routingMode}`);
    updates.routingMode = parsed.data;
  }
  if (options.testCommand !== undefined) updates.preferredTestCommand = options.testCommand;
  if (options.livePatch !== undefined) updates.preferredLivePatch = Boolean(options.livePatch);
  if (options.liveAdvisory !== undefined) updates.preferredLiveAdvisory = Boolean(options.liveAdvisory);

  if (!Object.keys(updates).length) {
    process.stdout.write(JSON.stringify(current, null, 2) + "\n");
    return;
  }

  const next = { ...current, ...updates };
  const path = await saveProjectPreferences(cwd, next);
  process.stdout.write(`updated ${path}\n`);
  process.stdout.write(JSON.stringify(next, null, 2) + "\n");
}
