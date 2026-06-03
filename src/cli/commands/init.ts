import { writeDefaultConfig } from "../../config/configLoader.js";

export async function initCommand(cwd: string): Promise<void> {
  const configPath = await writeDefaultConfig(cwd);
  process.stdout.write(`Created ${configPath}\n`);
  process.stdout.write("API keys are not stored in config. Use environment variables when enabling real providers.\n");
}
