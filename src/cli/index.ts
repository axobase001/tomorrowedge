#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import { initCommand } from "./commands/init.js";
import { runCommand } from "./commands/run.js";
import { tuiCommand } from "./commands/tui.js";
import { configCommand } from "./commands/config.js";
import { doctorCommand } from "./commands/doctor.js";
import { modelsCommand } from "./commands/models.js";
import { replayCommand, sessionsCommand } from "./commands/replay.js";
import { undoCommand } from "./commands/undo.js";
import { modeCommand } from "./commands/mode.js";
import { prefsCommand } from "./commands/prefs.js";
import { drillCommand } from "./commands/drill.js";
import { workflowCommand } from "./commands/workflow.js";
import { memoryCommand } from "./commands/memory.js";
import { reviewExportCommand } from "./commands/reviewExport.js";
import { traceCommand } from "./commands/trace.js";
import { exportCommand } from "./commands/export.js";

const program = new Command();
const cwd = process.cwd();
const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version: string };

program.name("tedge").description("TomorrowEdge multi-model coding agent cockpit").version(packageJson.version);

program
  .command("init")
  .description("Create .tomorrowedge/config.yaml")
  .option("--force", "overwrite an existing config with defaults")
  .option("--access-mode <mode>", "initial access mode: restricted, partial, or full")
  .option("--routing-mode <mode>", "initial routing mode")
  .option("--test-command <command>", "default verification command")
  .option("--provider <id>", "enable a provider by id in generated config")
  .option("--model <model>", "model to assign to --provider")
  .option("--allow-cloud-repo-context <value>", "true/false: allow repo context in cloud prompts")
  .action((options: { force?: boolean; accessMode?: string; routingMode?: string; testCommand?: string; provider?: string; model?: string; allowCloudRepoContext?: string }) => initCommand(cwd, options));

program
  .command("run")
  .description("Run a coding task through the offline agent graph by default")
  .argument("<task>", "task goal")
  .option("--headless", "print JSON instead of launching TUI")
  .option("--provider <provider>", "[deprecated] use --fixture-mode instead")
  .option("--fixture-mode", "use fixture provider for deterministic scripted responses")
  .option("--approve-patch", "allow the selected patch to be applied")
  .option("--approve-shell", "allow the proposed test command to run")
  .option("--access-mode <mode>", "access mode: restricted, partial, or full")
  .option("--repair-on-fail", "ask the repairer to propose a repair patch after a failed approved test")
  .option("--approve-repair", "allow a repair patch to be applied")
  .option("--red-team-review", "run an adversarial review pass before judge selection")
  .option("--live", "enable live advisory, patch, and vision routing when configured providers are available")
  .option("--offline", "force deterministic offline execution even when live providers are configured")
  .option("--live-advisory", "ask routed providers for advisory notes without changing files")
  .option("--live-patch", "ask routed coder providers for patch candidates without applying them")
  .option("--live-vision", "ask the routed vision provider to extract a structured visual spec from --image inputs")
  .option("--image <path>", "image/screenshot/diagram input; can be repeated", collectOption, [])
  .option("--fixture-failing-patch", "fixture-only: make the initial patch fail so repair can be demonstrated")
  .option("--test-command <command>", "override the proposed verification command")
  .action((task: string, options: { headless?: boolean; provider?: string; fixtureMode?: boolean; approvePatch?: boolean; approveShell?: boolean; accessMode?: "restricted" | "partial" | "full"; approveRepair?: boolean; repairOnFail?: boolean; redTeamReview?: boolean; live?: boolean; offline?: boolean; liveAdvisory?: boolean; livePatch?: boolean; liveVision?: boolean; image?: string[]; fixtureFailingPatch?: boolean; testCommand?: string }) => runCommand(cwd, task, options));

program.command("tui").description("Start the cockpit in the current repo").argument("[goal]", "optional displayed goal").action((goal?: string) => tuiCommand(cwd, goal));

program.command("config").description("Print resolved config").action(() => configCommand(cwd));

program.command("mode").description("View or set access mode").argument("[mode]", "restricted, partial, or full").action((mode?: string) => modeCommand(cwd, mode));

program
  .command("prefs")
  .description("View or update project preferences")
  .option("--access-mode <mode>", "preferred access mode")
  .option("--routing-mode <mode>", "preferred routing mode")
  .option("--test-command <command>", "preferred test command")
  .option("--live-patch", "prefer live patch candidates")
  .option("--live-advisory", "prefer live advisory notes")
  .option("--json", "print raw preferences JSON")
  .option("--list-keys", "show available preference keys")
  .action((options: { accessMode?: string; routingMode?: string; testCommand?: string; livePatch?: boolean; liveAdvisory?: boolean; json?: boolean; listKeys?: boolean }) => prefsCommand(cwd, options));

program
  .command("drill")
  .description("Run a non-mutating multi-model agent capability drill")
  .argument("<task>", "task goal")
  .option("--fixture <name>", "fixture repo under tests/fixtures", "sample-repo-basic")
  .option("--providers <ids>", "comma-separated provider ids", "openrouter,deepseek,mimo")
  .option("--include-mock", "include mock provider if selected")
  .action((task: string, options: { fixture?: string; providers?: string; includeMock?: boolean }) => drillCommand(cwd, task, options));

program
  .command("workflow")
  .description("Run a core-led multi-model workflow simulation and save a report")
  .argument("<task>", "task goal")
  .option("--providers <ids>", "comma-separated provider ids", "openrouter,deepseek,mimo")
  .option("--rounds <n>", "debate rounds, 1-5")
  .option("--output <format>", "json or markdown", "markdown")
  .action((task: string, options: { providers?: string; rounds?: string; output?: "json" | "markdown" }) => workflowCommand(cwd, task, options));

program
  .command("models")
  .description("List configured providers and models")
  .option("--real-smoke", "send a tiny live request to configured cloud providers")
  .option("--smoke-suite", "run text/json/vision smoke checks for configured cloud providers; reports failures without throwing")
  .action((options: { realSmoke?: boolean; smokeSuite?: boolean }) => modelsCommand(cwd, options));

program.command("doctor").description("Check local configuration and provider readiness").option("--json", "print machine-readable diagnostics").action((options: { json?: boolean }) => doctorCommand(cwd, options));

program.command("replay").description("Replay a saved local session").argument("<session-id>", "session id without .json").action((sessionId: string) => replayCommand(cwd, sessionId));

program.command("trace").description("Print a saved session event timeline").argument("[session-id]", "session id or latest", "latest").option("--verbose", "show artifact refs").action((sessionId: string, options: { verbose?: boolean }) => traceCommand(cwd, sessionId, options));

program.command("export").description("Export a saved session report").argument("[session-id]", "session id or latest", "latest").option("--format <format>", "markdown or json", "markdown").option("--include-artifacts", "include artifact file contents in JSON export").option("--brief", "print a compact terminal summary instead of full markdown").action((sessionId: string, options: { format?: "markdown" | "json"; includeArtifacts?: boolean; brief?: boolean }) => exportCommand(cwd, sessionId, options));

program.command("sessions").description("List saved local sessions").action(() => sessionsCommand(cwd));

program.command("memory").description("List learned local task memory").option("--limit <n>", "number of entries", "20").action((options: { limit?: string }) => memoryCommand(cwd, options));

program
  .command("review-export")
  .description("Export session review comments as GitHub or Google Docs style drafts")
  .argument("[session-id]", "session id or latest", "latest")
  .option("--format <format>", "github or google-docs", "github")
  .action((sessionId: string, options: { format?: "github" | "google-docs" }) => reviewExportCommand(cwd, sessionId, options));

program.command("undo").description("List or restore patch undo snapshots").option("--list", "list undo snapshots").option("--snapshot <id>", "restore a specific undo snapshot id").action((options: { list?: boolean; snapshot?: string }) => undoCommand(cwd, options));

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}
