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
import { diagnosticsCommand } from "./commands/diagnostics.js";
import { serveCommand } from "./commands/serve.js";
import { exportCommand } from "./commands/export.js";
import { githubReportCommand } from "./commands/githubReport.js";
import { mcpAgentsCommand, mcpInvokeCommand, mcpServeCommand, mcpStatusCommand, mcpToolsCommand } from "./commands/mcp.js";
import { askCommand, targetsCommand } from "./commands/conversation.js";

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
  .option("--to <target>", "conversation target: core, planner, reviewer, judge, coder, repairer, debate, or agent:<id>", "core")
  .option("--cwd <path>", "run against another project directory")
  .option("--workdir <path>", "alias for --cwd")
  .action((task: string, options: { headless?: boolean; provider?: string; fixtureMode?: boolean; approvePatch?: boolean; approveShell?: boolean; accessMode?: "restricted" | "partial" | "full"; approveRepair?: boolean; repairOnFail?: boolean; redTeamReview?: boolean; live?: boolean; offline?: boolean; liveAdvisory?: boolean; livePatch?: boolean; liveVision?: boolean; image?: string[]; fixtureFailingPatch?: boolean; testCommand?: string; to?: string; cwd?: string; workdir?: string }) => runCommand(cwd, task, { ...options, cwd: options.cwd ?? options.workdir }));

program.command("tui").description("Start the cockpit in the current repo").argument("[goal]", "optional displayed goal").option("--to <target>", "conversation target shown in the cockpit", "core").option("--session <id>", "open a saved session id or latest").action((goal: string | undefined, options: { to?: string; session?: string }) => tuiCommand(cwd, goal, options));

program.command("targets").description("List natural-language conversation targets").action(() => targetsCommand(cwd));

program.command("ask").description("Record a non-mutating directed natural-language message").argument("<message>", "message to route").option("--to <target>", "core, planner, reviewer, judge, coder, repairer, debate, or agent:<id>", "core").option("--headless", "print JSON instead of a compact summary").action((message: string, options: { to?: string; headless?: boolean }) => askCommand(cwd, message, options));

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
  .option("--include-mock", "include mock provider if selected")
  .option("--rounds <n>", "debate rounds, 1-5")
  .option("--output <format>", "json or markdown", "markdown")
  .action((task: string, options: { providers?: string; rounds?: string; output?: "json" | "markdown"; includeMock?: boolean }) => workflowCommand(cwd, task, options));

program
  .command("models")
  .description("List configured providers and models")
  .option("--real-smoke", "send a tiny live request to configured cloud providers")
  .option("--smoke-suite", "run text/json/vision smoke checks for configured cloud providers; reports failures without throwing")
  .option("--refresh-free", "fetch OpenRouter's live catalog and recommend free or low-cost onboarding models")
  .option("--configure-free <model-id>", "enable OpenRouter and set the selected free or low-cost model in .tomorrowedge/config.yaml")
  .option("--free-first", "when used with --configure-free, bind low-risk execution roles to the selected free model")
  .option("--connection-test", "test enabled provider endpoints with a lightweight HTTP /models request")
  .option("--provider <id>", "limit connection tests or catalog refresh to one provider; free refresh currently supports openrouter")
  .option("--limit <n>", "number of free/low-cost recommendations to print")
  .action((options: { realSmoke?: boolean; smokeSuite?: boolean; refreshFree?: boolean; configureFree?: string; freeFirst?: boolean; connectionTest?: boolean; provider?: string; limit?: string }) => modelsCommand(cwd, options));

program.command("doctor").description("Check local configuration and provider readiness").option("--json", "print machine-readable diagnostics").action((options: { json?: boolean }) => doctorCommand(cwd, options));

program.command("replay").description("Replay a saved local session").argument("<session-id>", "session id without .json").action((sessionId: string) => replayCommand(cwd, sessionId));

program.command("trace").description("Print a saved session event timeline").argument("[session-id]", "session id or latest", "latest").option("--verbose", "show artifact refs").option("--diagnostics", "append routing, projection, fallback, budget, and trace completeness diagnostics").action((sessionId: string, options: { verbose?: boolean; diagnostics?: boolean }) => traceCommand(cwd, sessionId, options));

program.command("diagnostics").description("Inspect workflow diagnostics for a saved session").argument("[action]", "on, latest, or a session id", "latest").action((action: string) => diagnosticsCommand(cwd, action));

program.command("serve").description("Start the local browser cockpit and narrow session API").option("--port <port>", "local port", "18792").option("--host <host>", "bind host", "127.0.0.1").option("--open", "open the cockpit in the default browser").action((options: { port?: string; host?: string; open?: boolean }) => serveCommand(cwd, options));

program.command("export").description("Export a saved session report").argument("[session-id]", "session id or latest", "latest").option("--format <format>", "markdown or json", "markdown").option("--include-artifacts", "include artifact file contents in JSON export").option("--brief", "print a compact terminal summary instead of full markdown").action((sessionId: string, options: { format?: "markdown" | "json"; includeArtifacts?: boolean; brief?: boolean }) => exportCommand(cwd, sessionId, options));

program
  .command("github-report")
  .description("Render or post a TomorrowEdge session report for a GitHub PR")
  .argument("[session-id]", "session id or latest", "latest")
  .option("--repo <owner/name>", "GitHub repository for --post-comment")
  .option("--pr <number>", "pull request number for --post-comment")
  .option("--dry-run", "print the report instead of posting")
  .option("--post-comment", "post the report as a GitHub PR comment through gh")
  .action((sessionId: string, options: { repo?: string; pr?: string; dryRun?: boolean; postComment?: boolean }) => githubReportCommand(cwd, sessionId, options));

program.command("sessions").description("List saved local sessions").action(() => sessionsCommand(cwd));

program.command("memory").description("List learned local task memory").option("--limit <n>", "number of entries", "20").action((options: { limit?: string }) => memoryCommand(cwd, options));

const mcp = program.command("mcp").description("Run or inspect the experimental TomorrowEdge MCP Agent Bridge").action(() => mcpStatusCommand());
mcp.command("serve").description("Serve TomorrowEdge MCP tools over stdio").action(() => mcpServeCommand(cwd));
mcp.command("tools").description("List TomorrowEdge MCP tools").action(() => mcpToolsCommand(cwd));
mcp.command("agents").description("List enabled external MCP agents").option("--probe", "start configured MCP commands and list their tools").option("--diagnose", "check local command, cwd, role, and capability configuration without spawning agents").action((options: { probe?: boolean; diagnose?: boolean }) => mcpAgentsCommand(cwd, options));
mcp.command("invoke").description("Invoke a configured external MCP agent process").argument("<agent-id>", "external agent id").option("--session <id>", "session id or latest", "latest").option("--role <role>", "workflow role", "reviewer").option("--tool <name>", "MCP tool name to call").option("--prompt <text>", "prompt for the external agent").action((agentId: string, options: { session?: string; role?: string; tool?: string; prompt?: string }) => mcpInvokeCommand(cwd, agentId, options));

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
