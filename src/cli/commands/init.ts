import { writeDefaultConfig } from "../../config/configLoader.js";

export type InitOptions = {
  force?: boolean;
};

export async function initCommand(cwd: string, options: InitOptions = {}): Promise<void> {
  const configPath = await writeDefaultConfig(cwd, { force: options.force });
  process.stdout.write(`${options.force ? "Reset" : "Created"} ${configPath}\n`);
  process.stdout.write("API keys are not stored in config. Use environment variables when enabling real providers.\n");
}
