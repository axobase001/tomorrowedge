import YAML from "yaml";
import { loadConfig } from "../../config/configLoader.js";

export function configCommand(cwd: string): void {
  process.stdout.write(YAML.stringify(loadConfig(cwd)));
}
