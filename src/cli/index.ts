#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import { initCommand } from "./commands/init.js";
import { runCommand } from "./commands/run.js";
import { tuiCommand } from "./commands/tui.js";
import { configCommand } from "./commands/config.js";
import { doctorCommand } from "./commands/doctor.js";
import { modelsCommand } from "./commands/models.js";
import { replayCommand, sessionsCommand, sessionsInspectCommand } from "./commands/replay.js";
import { undoCommand } from "./commands/undo.js";
import { modeCommand } from "./commands/mode.js";
import { prefsCommand } from "./commands/prefs.js";
import { drillCommand } from "./commands/drill.js";
import { benchmarkCommand } from "./commands/benchmark.js";
import { tbenchGuideCommand, tbenchSmokeCommand } from "./commands/tbench.js";
import { workflowCommand } from "./commands/workflow.js";
import { memoryCommand, memoryCompactCommand, memoryDeleteCommand, memoryExplainCommand, memoryExportCommand, memoryFailuresCommand, memoryPreviewCommand, memoryShowCommand } from "./commands/memory.js";
import { reviewExportCommand } from "./commands/reviewExport.js";
import { traceCommand } from "./commands/trace.js";
import { traceInspectCommand, traceListCommand } from "./commands/trace.js";
import { contractInspectCommand } from "./commands/contract.js";
import { policyEvalCommand, policyEvolveCommand, policyInspectCommand } from "./commands/policy.js";
import { diagnosticsCommand } from "./commands/diagnostics.js";
import { serveCommand } from "./commands/serve.js";
import { desktopCommand } from "./commands/desktop.js";
import { exportCommand } from "./commands/export.js";
import { githubReportCommand } from "./commands/githubReport.js";
import { mcpAgentsCommand, mcpInvokeCommand, mcpServeCommand, mcpStatusCommand, mcpToolsCommand } from "./commands/mcp.js";
import { askCommand, targetsCommand } from "./commands/conversation.js";
import { recipesCommand } from "./commands/recipes.js";
import { experimentDashboardCommand, experimentErrorLoopCommand } from "./commands/experiment.js";
import { skillsCandidatesCommand, skillsInspectCommand, skillsListCommand, skillsPacksCommand, skillsProposeCommand, skillsValidateCommand } from "./commands/skills.js";
import { councilRunCommand } from "./commands/council.js";
import { controlInitCommand, controlReportCommand, controlRunCommand, controlStatusCommand, controlValidateCommand } from "./commands/control.js";

const program = new Command();
program.enablePositionalOptions();
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
  .argument("[task]", "task goal")
  .option("--headless", "print JSON instead of launching an interactive cockpit")
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
  .option("--recipe <id>", "workflow recipe: review-only, bugfix-sprint, or security-audit")
  .option("--config <path>", "load an explicit TomorrowEdge config YAML")
  .option("--agent-council", "run through the Sirius Agent Council Governance Runtime")
  .option("--simulate-failure <task-node-id>", "Sirius council mode only: simulate a delegated task failure to exercise bounded mutation")
  .option("--to <target>", "conversation target: core, planner, reviewer, judge, coder, repairer, debate, or agent:<id>", "core")
  .option("--cwd <path>", "run against another project directory")
  .option("--workdir <path>", "alias for --cwd")
  .action((task: string | undefined, options: { headless?: boolean; provider?: string; fixtureMode?: boolean; approvePatch?: boolean; approveShell?: boolean; accessMode?: "restricted" | "partial" | "full"; approveRepair?: boolean; repairOnFail?: boolean; redTeamReview?: boolean; live?: boolean; offline?: boolean; liveAdvisory?: boolean; livePatch?: boolean; liveVision?: boolean; image?: string[]; fixtureFailingPatch?: boolean; testCommand?: string; recipe?: string; config?: string; agentCouncil?: boolean; simulateFailure?: string; to?: string; cwd?: string; workdir?: string }) => {
    if (options.agentCouncil) return councilRunCommand(cwd, task ?? "", { ...options, cwd: options.cwd ?? options.workdir });
    return runCommand(cwd, task ?? "", { ...options, cwd: options.cwd ?? options.workdir });
  });

const council = program.command("council").description("Run the Sirius Agent Council Governance Runtime");
council
  .command("run")
  .description("Route a high-level engineering task through chief agent, council planning, task ownership, delegated execution, mutation, and final chief review")
  .argument("<goal>", "high-level engineering goal")
  .option("--headless", "print JSON result metadata")
  .option("--fixture-mode", "use deterministic local workspace preparation")
  .option("--access-mode <mode>", "access mode: restricted, partial, or full")
  .option("--config <path>", "load an explicit TomorrowEdge config YAML")
  .option("--approve-patch", "mark patch actions approved in the run access policy")
  .option("--approve-shell", "mark shell actions approved in the run access policy")
  .option("--simulate-failure <task-node-id>", "simulate a delegated task failure to exercise bounded mutation")
  .option("--cwd <path>", "run against another project directory")
  .option("--workdir <path>", "alias for --cwd")
  .action((goal: string, options: { headless?: boolean; fixtureMode?: boolean; approvePatch?: boolean; approveShell?: boolean; accessMode?: string; config?: string; simulateFailure?: string; cwd?: string; workdir?: string }) => councilRunCommand(cwd, goal, { ...options, cwd: options.cwd ?? options.workdir }));

registerCanopusCommand("canopus", "Run the Canopus convergence runtime");
registerCanopusCommand("control", "Run the Canopus convergence runtime (compatibility alias)");

function registerCanopusCommand(name: string, description: string): void {
  const command = program.command(name).description(description);
  const warnIfLegacyAlias = () => {
    if (name === "control") {
      process.stderr.write("Warning: `tedge control` is a compatibility alias. Use `tedge canopus` instead.\n");
    }
  };
  command
    .command("init")
    .description("Create a structured Canopus objective/acceptance/policy YAML file")
    .option("--title <title>", "goal title", "Fix bug")
    .option("--mode <mode>", "coding, research, refactor, test, docs, or generic", "coding")
    .option("--output <path>", "output YAML path", "goal.yaml")
    .option("--force", "overwrite the output file")
    .action((options: { title?: string; mode?: string; output?: string; force?: boolean }) => {
      warnIfLegacyAlias();
      return controlInitCommand(cwd, options);
    });
  command
    .command("validate")
    .description("Validate a Canopus objective YAML")
    .argument("<goal-path>", "goal YAML path")
    .option("--json", "print machine-readable validation")
    .action((goalPath: string, options: { json?: boolean }) => {
      warnIfLegacyAlias();
      return controlValidateCommand(cwd, goalPath, options);
    });
  command
    .command("run")
    .description("Run observe/accept/delegate/re-accept/status convergence")
    .argument("<goal-path>", "goal YAML path")
    .option("--adapter <adapter>", "mock, noop, shell, or sirius-council", "mock")
    .option("--action-command <command>", "shell command for --adapter shell")
    .option("--config <path>", "explicit TomorrowEdge config for --adapter sirius-council")
    .option("--fixture-mode", "run Sirius Council AgentBridge in deterministic fixture mode")
    .option("--access-mode <mode>", "restricted, partial, or full for --adapter sirius-council")
    .option("--approve-patch", "pre-approve patch application for Sirius Council AgentBridge")
    .option("--approve-shell", "pre-approve shell execution for Sirius Council AgentBridge")
    .option("--simulate-failure <task-id>", "simulate a Sirius delegated task failure")
    .option("--run-id <id>", "explicit run id")
    .option("--cwd <path>", "workspace directory to reconcile")
    .option("--workdir <path>", "alias for --cwd")
    .option("--json", "print machine-readable result")
    .action((goalPath: string, options: { adapter?: string; actionCommand?: string; config?: string; fixtureMode?: boolean; accessMode?: string; approvePatch?: boolean; approveShell?: boolean; simulateFailure?: string; runId?: string; cwd?: string; workdir?: string; json?: boolean }) => {
      warnIfLegacyAlias();
      return controlRunCommand(cwd, goalPath, { ...options, cwd: options.cwd ?? options.workdir });
    });
  command
    .command("status")
    .description("Show latest Canopus RunState")
    .option("--run-id <id>", "run id; defaults to latest")
    .option("--cwd <path>", "workspace directory containing .runs")
    .option("--workdir <path>", "alias for --cwd")
    .option("--json", "print machine-readable status")
    .action((options: { runId?: string; cwd?: string; workdir?: string; json?: boolean }) => {
      warnIfLegacyAlias();
      return controlStatusCommand(cwd, { ...options, cwd: options.cwd ?? options.workdir });
    });
  command
    .command("report")
    .description("Print the persisted Canopus progress report")
    .option("--run-id <id>", "run id; defaults to latest")
    .option("--cwd <path>", "workspace directory containing .runs")
    .option("--workdir <path>", "alias for --cwd")
    .action((options: { runId?: string; cwd?: string; workdir?: string }) => {
      warnIfLegacyAlias();
      return controlReportCommand(cwd, { ...options, cwd: options.cwd ?? options.workdir });
    });
}

program.command("tui").description("Start the cockpit in the current repo").argument("[goal]", "optional displayed goal").option("--to <target>", "conversation target shown in the cockpit", "core").option("--session <id>", "open a saved session id or latest").action((goal: string | undefined, options: { to?: string; session?: string }) => tuiCommand(cwd, goal, options));

program
  .command("client")
  .description("Start the TomorrowEdge GUI client")
  .option("--port <port>", "local port", "18792")
  .option("--host <host>", "bind host", "127.0.0.1")
  .option("--config <path>", "load an explicit TomorrowEdge config YAML for launched runs")
  .option("--smoke-once", "start the local client, verify the cockpit shell once, then exit")
  .option("--no-open", "print the client URL without opening a browser")
  .action((options: { port?: string; host?: string; config?: string; smokeOnce?: boolean; open?: boolean }) => serveCommand(cwd, { ...options, open: options.open !== false }));

program
  .command("desktop")
  .description("Start the optional TomorrowEdge desktop app window")
  .option("--port <port>", "local port", "18792")
  .option("--host <host>", "bind host", "127.0.0.1")
  .option("--runtime <runtime>", "auto, app-mode, or electron", "auto")
  .action((options: { port?: string; host?: string; runtime?: string }) => desktopCommand(cwd, options));

program.command("targets").description("List natural-language conversation targets").action(() => targetsCommand(cwd));
program.command("recipes").description("List built-in coding workflow recipes").action(() => recipesCommand());

const skills = program.command("skills").description("Inspect governed skills, tool packs, and inert candidate proposals");
skills.command("list").description("List registered skills").option("--json", "print raw JSON").option("--scenario <type>", "filter by scenario type").option("--access-mode <mode>", "filter by access mode").action((options: { json?: boolean; scenario?: string; accessMode?: "restricted" | "partial" | "full" }) => skillsListCommand(cwd, options));
skills.command("packs").description("List registered skill/tool packs").option("--json", "print raw JSON").action((options: { json?: boolean }) => skillsPacksCommand(cwd, options));
skills.command("inspect").description("Inspect a skill manifest and lifecycle history").argument("<skill-id>", "skill id").option("--version <version>", "specific version").option("--json", "print raw JSON").action((skillId: string, options: { version?: string; json?: boolean }) => skillsInspectCommand(cwd, skillId, options));
skills.command("propose").description("Mine stored objective traces for inert candidate skill proposals").option("--min-support <n>", "minimum trace support", "2").option("--write", "write proposals to .tomorrowedge/candidate-skills.jsonl").option("--json", "print raw JSON").action((options: { minSupport?: string; write?: boolean; json?: boolean }) => skillsProposeCommand(cwd, options));
skills.command("candidates").description("List stored candidate skill proposals").option("--json", "print raw JSON").action((options: { json?: boolean }) => skillsCandidatesCommand(cwd, options));
skills.command("validate").description("Validate a skill manifest without enabling it").argument("<manifest-path>", "manifest JSON path").option("--access-mode <mode>", "validation access mode", "restricted").option("--json", "print raw JSON").action((manifestPath: string, options: { accessMode?: "restricted" | "partial" | "full"; json?: boolean }) => skillsValidateCommand(cwd, manifestPath, options));

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
  .option("--strategy-memory-routing <enabled>", "true/false: let learned strategy memory influence runtime routing")
  .option("--json", "print raw preferences JSON")
  .option("--list-keys", "show available preference keys")
  .action((options: { accessMode?: string; routingMode?: string; testCommand?: string; livePatch?: boolean; liveAdvisory?: boolean; strategyMemoryRouting?: string; json?: boolean; listKeys?: boolean }) => prefsCommand(cwd, options));

program
  .command("drill")
  .description("Run a non-mutating multi-model agent capability drill")
  .argument("<task>", "task goal")
  .option("--fixture <name>", "fixture repo under tests/fixtures", "sample-repo-basic")
  .option("--providers <ids>", "comma-separated provider ids", "openrouter,deepseek,mimo")
  .option("--include-mock", "include mock provider if selected")
  .action((task: string, options: { fixture?: string; providers?: string; includeMock?: boolean }) => drillCommand(cwd, task, options));

program
  .command("benchmark")
  .description("Run the offline quality-cost-trace benchmark demo")
  .option("--format <format>", "markdown or json", "markdown")
  .action((options: { format?: "json" | "markdown" }) => benchmarkCommand(cwd, options));

const tbench = program.command("tbench").description("Run or inspect the Terminal-Bench 2.1 Harbor adapter");
tbench
  .command("runtime")
  .description("Show the TomorrowEdge Terminal-Bench runtime contract and canonical smoke command")
  .option("--json", "print machine-readable metadata")
  .action((options: { json?: boolean }) => tbenchGuideCommand(cwd, options));
tbench
  .command("smoke")
  .description("Run a one-task Terminal-Bench 2.1 Harbor smoke with the TomorrowEdge agent")
  .option("--dataset <id>", "Harbor dataset id", "terminal-bench/terminal-bench-2-1")
  .option("--limit <n>", "number of tasks to sample", "1")
  .option("--n <n>", "trial count", "1")
  .option("--output-dir <path>", "Harbor output directory", ".tomorrowedge/tbench/jobs")
  .option("--job-name <name>", "Harbor job name", "tb21-tomorrowedge-smoke")
  .option("--agent-import-path <path>", "Python import path for custom Harbor agent")
  .option("--agent-timeout-multiplier <n>", "Harbor agent execution timeout multiplier")
  .option("--primary-model <id>", "OpenRouter model id for the primary terminal execution agent")
  .option("--advisor-model <id>", "OpenRouter model id for the pre-run strategy advisor")
  .option("--strong-model <id>", "OpenRouter model id for strong rescue intervention")
  .option("--escalation-after <n>", "invoke strong rescue after this many consecutive hard-gate failures")
  .option("--max-strong-interventions <n>", "maximum strong rescue calls per task")
  .option("--max-steps <n>", "maximum terminal action steps for the agent")
  .option("--strong-max-tokens <n>", "max output tokens for each strong rescue call")
  .option("--require-strong", "fail the trial if a configured strong rescue call returns no executable action")
  .option("--dry-run", "print the harbor command without running it")
  .option("--quiet", "pass -q to harbor")
  .action((options: { dataset?: string; limit?: string; n?: string; outputDir?: string; jobName?: string; agentImportPath?: string; agentTimeoutMultiplier?: string; primaryModel?: string; advisorModel?: string; strongModel?: string; escalationAfter?: string; maxStrongInterventions?: string; maxSteps?: string; strongMaxTokens?: string; requireStrong?: boolean; dryRun?: boolean; quiet?: boolean }) => tbenchSmokeCommand(cwd, options));

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
  .option("--provider <id>", "limit provider listing, smoke checks, connection tests, or catalog refresh to one provider; free refresh currently supports openrouter")
  .option("--limit <n>", "number of free/low-cost recommendations to print")
  .action((options: { realSmoke?: boolean; smokeSuite?: boolean; refreshFree?: boolean; configureFree?: string; freeFirst?: boolean; connectionTest?: boolean; provider?: string; limit?: string }) => modelsCommand(cwd, options));

program.command("doctor").description("Check local configuration and provider readiness").option("--json", "print machine-readable diagnostics").action((options: { json?: boolean }) => doctorCommand(cwd, options));

program.command("replay").description("Replay a saved local session").argument("<session-id>", "session id without .json").action((sessionId: string) => replayCommand(cwd, sessionId));

const trace = program.command("trace").description("Print or inspect saved session event timelines and objective traces").argument("[session-id]", "session id or latest", "latest").option("--verbose", "show artifact refs").option("--diagnostics", "append routing, projection, fallback, budget, and trace completeness diagnostics").option("--cwd <path>", "project/session root to inspect").option("--workdir <path>", "alias for --cwd").action((sessionId: string, options: { verbose?: boolean; diagnostics?: boolean; cwd?: string; workdir?: string }) => traceCommand(cwd, sessionId, { ...options, cwd: options.cwd ?? options.workdir }));
trace.command("inspect").description("Inspect an objective-action-feedback trace").argument("[session-id]", "session id, trace id, or latest", "latest").option("--json", "print raw JSON").option("--cwd <path>", "project/session root to inspect").option("--workdir <path>", "alias for --cwd").action((sessionId: string, options: { json?: boolean; cwd?: string; workdir?: string }) => traceInspectCommand(cwd, sessionId, { ...options, cwd: options.cwd ?? options.workdir }));
trace.command("list").description("List stored objective-action-feedback traces").option("--scenario <type>", "filter by scenario type").option("--limit <n>", "number of traces", "20").option("--json", "print raw JSON").action((options: { scenario?: string; limit?: string; json?: boolean }) => traceListCommand(cwd, options));

const contract = program.command("contract").description("Inspect Objective Contracts");
contract.command("inspect").description("Inspect a session Objective Contract").argument("[session-id]", "session id or latest", "latest").option("--json", "print raw JSON").action((sessionId: string, options: { json?: boolean }) => contractInspectCommand(cwd, sessionId, options));

const policy = program.command("policy").description("Inspect or evolve orchestration policies");
policy.command("inspect").description("Inspect the selected trace-guided orchestration policy").option("--json", "print raw JSON").action((options: { json?: boolean }) => policyInspectCommand(cwd, options));
policy.command("evolve").description("Run offline policy evolution over stored objective traces").option("--offline", "use stored objective traces only", true).option("--generations <n>", "offline generations", "1").option("--population <n>", "mutated policy variants per generation").option("--elite <n>", "selected policies to retain").option("--json", "print raw JSON").action((options: { offline?: boolean; generations?: string; population?: string; elite?: string; json?: boolean }) => policyEvolveCommand(cwd, options));
policy.command("eval").description("Evaluate the selected policy against stored traces").option("--taskset <path>", "optional taskset file to summarize alongside trace evaluation").option("--json", "print raw JSON").action((options: { taskset?: string; json?: boolean }) => policyEvalCommand(cwd, options));

program.command("diagnostics").description("Inspect workflow diagnostics for a saved session").argument("[action]", "on, latest, or a session id", "latest").action((action: string) => diagnosticsCommand(cwd, action));

program.command("serve").description("Start the local browser cockpit and narrow session API").option("--port <port>", "local port", "18792").option("--host <host>", "bind host", "127.0.0.1").option("--config <path>", "load an explicit TomorrowEdge config YAML for launched runs").option("--open", "open the cockpit in the default browser").action((options: { port?: string; host?: string; config?: string; open?: boolean }) => serveCommand(cwd, options));

program.command("export").description("Export a saved session report").argument("[session-id]", "session id or latest", "latest").option("--format <format>", "markdown or json", "markdown").option("--include-artifacts", "include artifact file contents in JSON export").option("--brief", "print a compact terminal summary instead of full markdown").option("--cwd <path>", "project/session root to inspect").option("--workdir <path>", "alias for --cwd").action((sessionId: string, options: { format?: "markdown" | "json"; includeArtifacts?: boolean; brief?: boolean; cwd?: string; workdir?: string }) => exportCommand(cwd, sessionId, { ...options, cwd: options.cwd ?? options.workdir }));

program
  .command("github-report")
  .description("Render or post a TomorrowEdge session report for a GitHub PR")
  .argument("[session-id]", "session id or latest", "latest")
  .option("--repo <owner/name>", "GitHub repository for posting")
  .option("--pr <number>", "pull request number for posting or check SHA lookup")
  .option("--sha <commit>", "commit SHA for --post-check")
  .option("--dry-run", "print the report instead of posting")
  .option("--post-comment", "post the report as a GitHub PR comment through gh")
  .option("--post-check", "post the report as a GitHub Checks API check run through gh api")
  .option("--check-name <name>", "check run name", "TomorrowEdge report")
  .action((sessionId: string, options: { repo?: string; pr?: string; sha?: string; dryRun?: boolean; postComment?: boolean; postCheck?: boolean; checkName?: string }) => githubReportCommand(cwd, sessionId, options));

const sessions = program.command("sessions").description("List or inspect saved local sessions").action(() => sessionsCommand(cwd));
sessions
  .command("inspect")
  .description("Inspect a saved local session summary")
  .argument("[session-id]", "session id or latest", "latest")
  .option("--json", "print raw JSON")
  .option("--cwd <path>", "project/session root to inspect")
  .option("--workdir <path>", "alias for --cwd")
  .action((sessionId: string, options: { json?: boolean; cwd?: string; workdir?: string }) => sessionsInspectCommand(cwd, sessionId, { ...options, cwd: options.cwd ?? options.workdir }));

const memory = program
  .command("memory")
  .description("Inspect learned local task and failure memory")
  .option("--limit <n>", "number of entries", "20")
  .option("--strategy [task]", "show opt-in strategy memory routing and test-command hints; optionally scope to a task")
  .option("--json", "print machine-readable JSON")
  .action((options: { limit?: string; strategy?: boolean | string; json?: boolean }) => memoryCommand(cwd, options));
const memoryFailures = memory.command("failures").description("List structured failure memories").option("--limit <n>", "number of entries", "20").option("--include-stale", "include stale failure memories rejected by lifecycle policy").option("--json", "print machine-readable JSON");
memoryFailures.action(() => memoryFailuresCommand(cwd, memoryFailures.opts() as { limit?: string; json?: boolean; includeStale?: boolean }));
const memoryShow = memory.command("show").description("Show one failure memory by id or goal fingerprint").argument("<id>", "failure memory id or goal fingerprint").option("--include-stale", "allow showing stale failure memories").option("--json", "print machine-readable JSON");
memoryShow.action((id: string) => memoryShowCommand(cwd, id, memoryShow.opts() as { json?: boolean; includeStale?: boolean }));
const memoryExplain = memory.command("explain").description("Explain which failure memories apply to a task").argument("<task>", "task goal or natural-language problem").option("--limit <n>", "number of selected memories", "5").option("--json", "print machine-readable JSON");
memoryExplain.action((task: string) => memoryExplainCommand(cwd, task, memoryExplain.opts() as { limit?: string; json?: boolean }));
const memoryPreview = memory.command("preview").description("Preview the failure memory record that would be stored for a saved session").argument("<session-id>", "session id").option("--json", "print machine-readable JSON");
memoryPreview.action((sessionId: string) => memoryPreviewCommand(cwd, sessionId, memoryPreview.opts() as { json?: boolean }));
const memoryExport = memory.command("export").description("Export failure memories as JSON").option("--output <file>", "write JSON to a file instead of stdout").option("--include-stale", "include stale records rejected by lifecycle policy");
memoryExport.action(() => memoryExportCommand(cwd, memoryExport.opts() as { output?: string; includeStale?: boolean }));
const memoryDelete = memory.command("delete").description("Delete one failure memory by id or goal fingerprint").argument("<id>", "failure memory id or goal fingerprint");
memoryDelete.action((id: string) => memoryDeleteCommand(cwd, id));
const memoryCompact = memory.command("compact").description("Remove stale failure memories and optionally cap retained records").option("--keep-stale", "keep stale records while applying the limit").option("--limit <n>", "maximum retained records").option("--json", "print machine-readable JSON");
memoryCompact.action(() => memoryCompactCommand(cwd, memoryCompact.opts() as { keepStale?: boolean; limit?: string; json?: boolean }));

const experiment = program.command("experiment").description("Run deterministic workflow experiments and export reproducible bundles");
experiment
  .command("error-loop")
  .description("Run a deterministic no-key error-loop experiment and export manifest, trials, memory, retrieval, metrics, and report files")
  .option("--tasks <list>", "semicolon-separated task list")
  .option("--repetitions <n>", "number of repetitions per task and ablation", "1")
  .option("--ablation <modes>", "comma-separated baseline modes or ablations: direct,reflection_only,preference_feedback,error_memory,memory_on,memory_off,write_only,retrieve_only,success_memory_only,failure_memory_only,random_memory_control", "memory_on")
  .option("--memory-policy <mode>", "failure-memory retrieval policy: balanced,exploit_memory,explore_alternative,random_control")
  .option("--output-dir <path>", "output directory for the reproducibility bundle")
  .option("--seed <seed>", "recorded deterministic seed label")
  .option("--json", "print machine-readable result metadata")
  .action((options: { tasks?: string; repetitions?: string; ablation?: string; memoryPolicy?: string; outputDir?: string; seed?: string; json?: boolean }) => experimentErrorLoopCommand(cwd, options));
experiment
  .command("dashboard")
  .description("Build a local HTML cohort dashboard from an error-loop experiment output directory")
  .requiredOption("--input-dir <path>", "error-loop experiment output directory")
  .option("--output-dir <path>", "dashboard output directory; defaults to <input-dir>/dashboard")
  .option("--json", "print machine-readable result metadata")
  .action((options: { inputDir?: string; outputDir?: string; json?: boolean }) => experimentDashboardCommand(cwd, options));

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
