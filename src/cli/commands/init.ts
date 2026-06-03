import { writeDefaultConfig } from "../../config/configLoader.js";

export async function initCommand(cwd: string, options: { force?: boolean } = {}): Promise<void> {
  const result = await writeDefaultConfig(cwd, options);
  if (!result.created && !result.overwritten) {
    process.stdout.write(`Config already exists: ${result.path}\n`);
    process.stdout.write("No changes written. Use tedge init --force to replace it with defaults.\n");
    return;
  }
  process.stdout.write(`${result.overwritten ? "Replaced" : "Created"} ${result.path}\n`);
  process.stdout.write("API keys are not stored in config. Use environment variables when enabling real providers.\n");
}
