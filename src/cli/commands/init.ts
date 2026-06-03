import { loadConfig, writeConfig, writeDefaultConfig } from "../../config/configLoader.js";
import { accessModeSchema, routingModeSchema, type TomorrowEdgeConfig } from "../../config/schema.js";
import { saveProjectPreferences } from "../../core/memory/preferences.js";

export type InitOptions = {
  force?: boolean;
  accessMode?: string;
  routingMode?: string;
  testCommand?: string;
  provider?: string;
  model?: string;
  allowCloudRepoContext?: string;
};

export async function initCommand(cwd: string, options: InitOptions = {}): Promise<void> {
  const result = await writeDefaultConfig(cwd, options);
  if (!result.created && !result.overwritten) {
    process.stdout.write(`Config already exists: ${result.path}\n`);
    process.stdout.write("No changes written. Use tedge init --force to replace it with defaults.\n");
    return;
  }
  const config = applyInitOptions(loadConfig(cwd), options);
  await writeConfig(cwd, config);
  if (options.accessMode || options.routingMode || options.testCommand) {
    await saveProjectPreferences(cwd, {
      accessMode: config.project.access_mode,
      routingMode: config.routing.mode,
      preferredTestCommand: options.testCommand
    });
  }
  process.stdout.write(`${result.overwritten ? "Replaced" : "Created"} ${result.path}\n`);
  process.stdout.write("API keys are not stored in config. Use environment variables when enabling real providers.\n");
  process.stdout.write(renderNextSteps(config, Boolean(options.provider)));
}

function applyInitOptions(config: TomorrowEdgeConfig, options: InitOptions): TomorrowEdgeConfig {
  const next: TomorrowEdgeConfig = { ...config, project: { ...config.project }, routing: { ...config.routing }, privacy: { ...config.privacy }, providers: { ...config.providers } };
  if (options.accessMode) {
    const parsed = accessModeSchema.safeParse(options.accessMode);
    if (!parsed.success) throw new Error(`Invalid access mode: ${options.accessMode}. Use restricted, partial, or full.`);
    next.project.access_mode = parsed.data;
  }
  if (options.routingMode) {
    const parsed = routingModeSchema.safeParse(options.routingMode);
    if (!parsed.success) throw new Error(`Invalid routing mode: ${options.routingMode}.`);
    next.routing.mode = parsed.data;
  }
  if (options.allowCloudRepoContext !== undefined) {
    next.privacy.allow_cloud_repo_context = parseBoolean(options.allowCloudRepoContext, "allow-cloud-repo-context");
  }
  if (options.provider) {
    const existing = next.providers[options.provider];
    if (!existing) throw new Error(`Unknown provider: ${options.provider}. Run tedge config to inspect available provider ids.`);
    next.providers[options.provider] = { ...existing, enabled: true, model: options.model ?? existing.model };
  }
  return next;
}

function parseBoolean(value: string, name: string): boolean {
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  throw new Error(`Invalid ${name}: ${value}. Use true or false.`);
}

function renderNextSteps(config: TomorrowEdgeConfig, providerConfigured: boolean): string {
  const lines = [
    "",
    "First run next steps:",
    "1. Run tedge doctor to check config and provider readiness.",
    `2. Current access mode is ${config.project.access_mode}. Change it with tedge mode restricted|partial|full.`,
    `3. Current routing mode is ${config.routing.mode}. Change it with tedge prefs --routing-mode <mode>.`,
    "4. Try the offline fixture: tedge run \"fix failing test\" --headless --fixture-mode --approve-patch --approve-shell.",
    "5. For real providers, put API keys in environment variables, not config.yaml."
  ];
  if (!providerConfigured) lines.push("6. Enable a provider later by editing .tomorrowedge/config.yaml or rerunning init with --force --provider <id>.");
  return `${lines.join("\n")}\n`;
}
