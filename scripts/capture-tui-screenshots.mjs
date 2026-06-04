import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { chromium } from "playwright";

const outDir = path.resolve("docs/assets/screenshots");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

await mkdir(outDir, { recursive: true });

const partialRun = await hydrateRun(await runTedge([
  "run",
  "fix failing test",
  "--headless",
  "--fixture-mode",
  "--approve-patch",
  "--approve-shell"
]));

const fullRepairRun = await hydrateRun(await runTedge([
  "run",
  "fix failing test",
  "--headless",
  "--fixture-mode",
  "--access-mode",
  "full",
  "--repair-on-fail",
  "--fixture-failing-patch"
]));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

await capture(
  page,
  cockpitScreen({
    title: "TomorrowEdge / 明日边缘",
    subtitle: "TUI runtime cockpit",
    run: partialRun,
    selected: "orchestration"
  }),
  path.join(outDir, "tui-runtime-cockpit.png")
);

await capture(
  page,
  traceScreen({
    title: "Trace Ledger / 可审计事件账本",
    subtitle: "full-access repair run",
    run: fullRepairRun
  }),
  path.join(outDir, "tui-runtime-trace.png")
);

await browser.close();

console.log("Captured TUI runtime screenshots:");
console.log(`- ${path.join(outDir, "tui-runtime-cockpit.png")}`);
console.log(`- ${path.join(outDir, "tui-runtime-trace.png")}`);

async function runTedge(args) {
  const { stdout } = await execa(npmCmd, ["run", "dev", "--", ...args], {
    cwd: process.cwd(),
    timeout: 180_000,
    env: {
      ...process.env,
      NO_COLOR: "1"
    }
  });
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not parse JSON output from tedge ${args.join(" ")}`);
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

async function hydrateRun(run) {
  const sessionId = run.sessionId ?? await newestSessionId();
  const sessionPath = path.join(".tomorrowedge", "sessions", sessionId, "session.json");
  const raw = await readFile(sessionPath, "utf8");
  const session = JSON.parse(raw);
  return {
    ...run,
    ...session.state,
    sessionId,
    sessionPath
  };
}

async function newestSessionId() {
  const sessionsDir = path.join(".tomorrowedge", "sessions");
  const entries = await readdir(sessionsDir, { withFileTypes: true });
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionPath = path.join(sessionsDir, entry.name, "session.json");
    const raw = await readFile(sessionPath, "utf8").catch(() => undefined);
    if (!raw) continue;
    const session = JSON.parse(raw);
    sessions.push({ id: entry.name, createdAt: session.createdAt ?? "" });
  }
  sessions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!sessions.length) throw new Error("No TomorrowEdge session found after run.");
  return sessions[0].id;
}

async function capture(page, html, outputPath) {
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: outputPath, fullPage: false });
}

function cockpitScreen({ title, subtitle, run, selected }) {
  const events = run.events ?? [];
  const agents = run.agents ?? [];
  const changedFiles = run.changedFiles ?? [];
  const modelNotes = run.modelNotes ?? [];
  const shellRuns = run.runResults ?? [];
  const latestShell = shellRuns.at(-1);
  const diff = firstDiff(run);

  return shellFrame({
    title,
    subtitle,
    badge: `MODE ${upper(run.access?.mode ?? run.accessMode ?? "partial")}`,
    sections: [
      headerBar([
        ["Task", run.goal ?? run.task ?? "fix failing test"],
        ["Backend", run.backend ?? "native"],
        ["Provider route", agents.map((agent) => agent.provider).filter(Boolean).join(" / ") || "fixture"],
        ["Events", String(events.length)]
      ]),
      grid(
        pane(
          "Agents",
          agents.map((agent) =>
            row([
              tag(agent.role ?? "agent"),
              text(agent.model ?? "fixture-model"),
              dim(agent.provider ?? "fixture"),
              status("ready")
            ])
          )
        ),
        pane(
          "Capability Route",
          [
            routeLine("Planner", providerFor(agents, "planner")),
            routeLine("Explorer", providerFor(agents, "explorer")),
            routeLine("Coder", providerFor(agents, "coder")),
            routeLine("Reviewer", providerFor(agents, "reviewer")),
            routeLine("Judge", providerFor(agents, "judge")),
            routeLine("Runner", "local shell")
          ]
        )
      ),
      grid(
        pane("Patch Candidate", [
          row([tag("diff"), text(changedFiles.join(", ") || "index.js"), status(run.patchApplied ? "applied" : "preview")]),
          codeBlock(diff || "No patch candidate captured.")
        ]),
        pane("Judge / Review", [
          row([tag("review"), text(run.review?.overallRecommendation ?? run.review?.verdict ?? "approved"), status("recorded")]),
          row([tag("judge"), text(run.judge?.decision ?? "accept"), status("recorded")]),
          row([tag("shell"), text(latestShell?.command ?? "npm test"), status(latestShell?.success ? "passed" : "waiting")]),
          ...modelNotes.slice(0, 3).map((note) => dim(note))
        ])
      ),
      footer(selected, events.slice(-5))
    ]
  });
}

function traceScreen({ title, subtitle, run }) {
  const events = run.events ?? [];
  const shellRuns = run.runResults ?? [];
  const diff = firstDiff(run);

  return shellFrame({
    title,
    subtitle,
    badge: "FULL AUTONOMY",
    sections: [
      headerBar([
        ["Task", run.goal ?? run.task ?? "fix failing test"],
        ["Access", run.access?.mode ?? run.accessMode ?? "full"],
        ["Repair attempts", String((events.filter((event) => event.type === "repair_attempt")).length)],
        ["Shell runs", String(shellRuns.length)]
      ]),
      grid(
        pane(
          "Event Ledger",
          events.slice(-16).map((event) =>
            row([
              dim(timeOf(event)),
              tag(event.type ?? "event"),
              text(event.agent ?? event.role ?? event.provider ?? "system"),
              status(event.status ?? event.decision ?? "logged")
            ])
          )
        ),
        pane("Shell Output Artifacts", shellRuns.map((runResult, index) => [
          row([
            tag(`run ${index + 1}`),
            text(runResult.command ?? "npm test"),
            status(runResult.success ? "passed" : "failed")
          ]),
          codeBlock(compactShell(runResult))
        ]).flat())
      ),
      pane("Applied Patch / Repair Diff", [codeBlock(diff || "No diff captured.")]),
      footer("trace verbose", events.slice(-6))
    ]
  });
}

function shellFrame({ title, subtitle, badge, sections }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    :root {
      color-scheme: dark;
      --bg: #070b0f;
      --panel: #0c1218;
      --panel-2: #101821;
      --line: #2a3742;
      --line-strong: #4d6578;
      --text: #d8e2ea;
      --muted: #81919d;
      --accent: #67e8f9;
      --good: #8bdc9b;
      --warn: #e4c76f;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; background: var(--bg); }
    body {
      font-family: "Cascadia Mono", "JetBrains Mono", Consolas, monospace;
      color: var(--text);
      padding: 28px;
      letter-spacing: 0;
    }
    .terminal {
      width: 100%;
      height: 100%;
      border: 1px solid var(--line-strong);
      background: linear-gradient(180deg, #091017 0%, #070b0f 100%);
      box-shadow: 0 0 0 1px rgba(103, 232, 249, 0.08), 0 24px 70px rgba(0, 0, 0, 0.45);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .top {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 18px;
      align-items: center;
      border-bottom: 1px solid var(--line);
      padding: 16px 20px;
      background: #0b1117;
    }
    h1 { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.25; }
    .sub { color: var(--muted); margin-top: 4px; font-size: 13px; }
    .badge {
      border: 1px solid var(--accent);
      color: var(--accent);
      padding: 7px 10px;
      font-size: 12px;
      text-transform: uppercase;
      background: rgba(103, 232, 249, 0.07);
    }
    .content {
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-height: 0;
      overflow: hidden;
    }
    .statusbar {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      border: 1px solid var(--line);
      background: var(--panel);
    }
    .metric { padding: 12px 14px; border-right: 1px solid var(--line); min-width: 0; }
    .metric:last-child { border-right: 0; }
    .label { color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 5px; }
    .value { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      min-height: 0;
    }
    .pane {
      border: 1px solid var(--line);
      background: var(--panel);
      min-height: 0;
      overflow: hidden;
    }
    .pane-title {
      border-bottom: 1px solid var(--line);
      background: var(--panel-2);
      padding: 9px 12px;
      color: #f0f6fa;
      font-size: 13px;
      font-weight: 700;
    }
    .pane-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 7px; }
    .row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 10px;
      min-height: 24px;
      font-size: 13px;
    }
    .tag {
      color: var(--accent);
      border: 1px solid rgba(103, 232, 249, 0.38);
      padding: 2px 6px;
      min-width: 72px;
      text-align: center;
    }
    .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .muted { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ok { color: var(--good); }
    .warn { color: var(--warn); }
    pre {
      margin: 0;
      border-left: 2px solid rgba(103, 232, 249, 0.45);
      padding: 8px 10px;
      background: rgba(0, 0, 0, 0.20);
      color: #c8d5dc;
      font: inherit;
      font-size: 12px;
      line-height: 1.38;
      white-space: pre-wrap;
      max-height: 205px;
      overflow: hidden;
    }
    .footer {
      margin-top: auto;
      border-top: 1px solid var(--line);
      color: var(--muted);
      padding-top: 10px;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 14px;
      font-size: 12px;
    }
    .focus { color: var(--accent); }
  </style>
</head>
<body>
  <main class="terminal">
    <div class="top">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="sub">${escapeHtml(subtitle)} · captured from actual tedge fixture runtime with current provider config</div>
      </div>
      <div class="badge">${escapeHtml(badge)}</div>
    </div>
    <div class="content">${sections.join("")}</div>
  </main>
</body>
</html>`;
}

function headerBar(items) {
  return `<section class="statusbar">${items.map(([label, value]) => `
    <div class="metric">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(String(value))}</div>
    </div>
  `).join("")}</section>`;
}

function grid(left, right) {
  return `<section class="grid">${left}${right}</section>`;
}

function pane(title, lines) {
  return `<section class="pane">
    <div class="pane-title">${escapeHtml(title)}</div>
    <div class="pane-body">${lines.flat().join("")}</div>
  </section>`;
}

function footer(focus, events) {
  return `<section class="footer">
    <div class="focus">focus: ${escapeHtml(focus)}</div>
    <div>${escapeHtml(events.map((event) => `${event.type}:${event.status ?? event.decision ?? "ok"}`).join("  |  "))}</div>
  </section>`;
}

function routeLine(role, provider) {
  return row([tag(role), text(provider), dim("capability routed"), status("ok")]);
}

function row(parts) {
  return `<div class="row">${parts.join("")}</div>`;
}

function tag(value) {
  return `<span class="tag">${escapeHtml(String(value))}</span>`;
}

function text(value) {
  return `<span class="text">${escapeHtml(String(value))}</span>`;
}

function dim(value) {
  return `<span class="muted">${escapeHtml(String(value))}</span>`;
}

function status(value) {
  const normalized = String(value);
  const cls = /fail|warn|waiting|blocked/i.test(normalized) ? "warn" : "ok";
  return `<span class="${cls}">${escapeHtml(normalized)}</span>`;
}

function codeBlock(value) {
  return `<pre>${escapeHtml(trimText(String(value), 1200))}</pre>`;
}

function providerFor(agents, role) {
  const agent = agents.find((candidate) => String(candidate.role ?? "").toLowerCase().includes(role));
  if (!agent) return "fixture";
  return `${agent.provider ?? "fixture"} / ${agent.model ?? "model"}`;
}

function firstDiff(run) {
  const candidates = run.candidates ?? run.patchCandidates ?? [];
  const repairs = run.repairCandidates ?? [];
  const repairDiff = repairs.find((candidate) => candidate.unifiedDiff)?.unifiedDiff;
  if (repairDiff) return repairDiff;
  const candidateDiff = candidates.find((candidate) => candidate.unifiedDiff)?.unifiedDiff;
  if (candidateDiff) return candidateDiff;
  const direct = candidates.find((candidate) => candidate.diff)?.diff;
  if (direct) return direct;
  if (run.diff) return run.diff;
  const event = (run.events ?? []).find((entry) => entry.diff || entry.diffPreview);
  return event?.diff ?? event?.diffPreview ?? "";
}

function compactShell(runResult) {
  const stdout = runResult.stdout ?? runResult.output ?? "";
  const stderr = runResult.stderr ? `\n${runResult.stderr}` : "";
  return trimText(`${stdout}${stderr}`.trim() || JSON.stringify(runResult, null, 2), 900);
}

function timeOf(event) {
  const raw = event.at ?? event.timestamp ?? event.time;
  if (!raw) return "now";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw);
  return date.toISOString().slice(11, 19);
}

function upper(value) {
  return String(value).toUpperCase();
}

function trimText(value, max) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 20)}\n... truncated ...`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
