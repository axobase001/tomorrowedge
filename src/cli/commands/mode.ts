import { loadConfig, writeConfig } from "../../config/configLoader.js";
import { accessModeSchema, type AccessMode } from "../../config/schema.js";

export async function modeCommand(cwd: string, mode?: string): Promise<void> {
  const config = loadConfig(cwd);
  if (!mode) {
    process.stdout.write(`access_mode: ${config.project.access_mode}\n`);
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
  process.stdout.write(`access_mode set to ${parsed.data}\n`);
  process.stdout.write(`updated ${path}\n`);
}
