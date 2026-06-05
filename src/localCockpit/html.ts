export function renderCockpitHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TomorrowEdge Cockpit</title>
  <style>${cockpitCss()}</style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>TomorrowEdge / 明日边缘</h1>
        <p>Local full-access coding workflow cockpit</p>
      </div>
      <div class="top-actions">
        <button id="refresh">Refresh</button>
        <button id="run-preview">Run Preview</button>
        <span id="mode" class="badge">LOCAL</span>
      </div>
    </header>
    <section class="toolbar">
      <label>Session <select id="sessions"></select></label>
      <label>Goal <input id="goal" value="fix failing test" /></label>
      <span id="status" class="muted">loading</span>
    </section>
    <section class="metrics">
      <article><span>Task</span><strong id="metric-task">-</strong></article>
      <article><span>Access</span><strong id="metric-access">-</strong></article>
      <article><span>Route</span><strong id="metric-route">-</strong></article>
      <article><span>Events</span><strong id="metric-events">-</strong></article>
      <article><span>Trace</span><strong id="metric-trace">-</strong></article>
    </section>
    <section class="grid">
      <article class="panel">
        <h2>Agents</h2>
        <div id="agents" class="list"></div>
      </article>
      <article class="panel">
        <h2>Capability / Role Route</h2>
        <div id="route" class="list"></div>
      </article>
      <article class="panel large">
        <h2>Patch Candidate</h2>
        <pre id="diff">No diff selected.</pre>
      </article>
      <article class="panel">
        <h2>Review / Judge / Shell</h2>
        <div id="decision" class="list"></div>
      </article>
      <article class="panel">
        <h2>Diagnostics</h2>
        <div id="diagnostics" class="list"></div>
      </article>
      <article class="panel large">
        <h2>Trace Ledger</h2>
        <div id="events" class="events"></div>
      </article>
    </section>
  </main>
  <script>${cockpitJs()}</script>
</body>
</html>`;
}

function cockpitCss(): string {
  return `
:root {
  color-scheme: dark;
  --bg: #070b0f;
  --panel: #0c1218;
  --panel-2: #101821;
  --line: #283746;
  --line-strong: #4d6578;
  --text: #d8e2ea;
  --muted: #81919d;
  --accent: #67e8f9;
  --good: #8bdc9b;
  --warn: #e4c76f;
  --bad: #ef8f8f;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: radial-gradient(circle at 65% -10%, rgba(103, 232, 249, 0.10), transparent 32rem), var(--bg);
  color: var(--text);
  font-family: "Cascadia Mono", "JetBrains Mono", Consolas, monospace;
  letter-spacing: 0;
}
.shell {
  margin: 22px auto;
  width: min(1480px, calc(100vw - 32px));
  min-height: calc(100vh - 44px);
  border: 1px solid var(--line-strong);
  background: linear-gradient(180deg, #091017, #070b0f);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.48);
}
.topbar, .toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}
h1 { margin: 0; font-size: 22px; }
p { margin: 4px 0 0; color: var(--muted); }
button, select, input {
  background: #09131b;
  color: var(--text);
  border: 1px solid var(--line-strong);
  padding: 8px 10px;
  font: inherit;
}
button { cursor: pointer; }
button:hover { border-color: var(--accent); color: var(--accent); }
input { min-width: 340px; }
.top-actions { display: flex; gap: 10px; align-items: center; }
.badge {
  border: 1px solid var(--accent);
  color: var(--accent);
  padding: 8px 10px;
  background: rgba(103, 232, 249, 0.06);
}
.muted { color: var(--muted); }
.metrics {
  display: grid;
  grid-template-columns: 1.2fr 0.7fr 1.5fr 0.5fr 0.5fr;
  gap: 0;
  margin: 18px;
  border: 1px solid var(--line);
}
.metrics article {
  min-width: 0;
  padding: 12px 14px;
  border-right: 1px solid var(--line);
}
.metrics article:last-child { border-right: 0; }
.metrics span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 5px; }
.metrics strong { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 0 18px 18px;
}
.panel {
  min-height: 225px;
  border: 1px solid var(--line);
  background: var(--panel);
  overflow: hidden;
}
.panel.large { min-height: 285px; }
.panel h2 {
  margin: 0;
  padding: 10px 12px;
  font-size: 14px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--line);
}
.list { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 25px;
  font-size: 13px;
}
.tag {
  min-width: 88px;
  text-align: center;
  border: 1px solid rgba(103, 232, 249, 0.38);
  color: var(--accent);
  padding: 3px 6px;
}
.text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ok { color: var(--good); }
.warn { color: var(--warn); }
.bad { color: var(--bad); }
pre {
  margin: 12px;
  max-height: 235px;
  overflow: auto;
  white-space: pre-wrap;
  background: rgba(0, 0, 0, 0.24);
  border-left: 2px solid rgba(103, 232, 249, 0.45);
  padding: 10px 12px;
  color: #c8d5dc;
  font: inherit;
  font-size: 12px;
  line-height: 1.42;
}
.events {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 245px;
  overflow: auto;
  font-size: 12px;
}
.event { display: grid; grid-template-columns: 82px 150px minmax(0, 1fr); gap: 10px; }
.event span { color: var(--muted); }
@media (max-width: 980px) {
  .grid, .metrics { grid-template-columns: 1fr; }
  .metrics article { border-right: 0; border-bottom: 1px solid var(--line); }
  .toolbar { align-items: stretch; flex-direction: column; }
  input { min-width: 0; width: 100%; }
}`;
}

function cockpitJs(): string {
  return `
const el = (id) => document.getElementById(id);
let selectedSession = "latest";

el("refresh").addEventListener("click", () => load());
el("sessions").addEventListener("change", (event) => {
  selectedSession = event.target.value || "latest";
  loadSession(selectedSession);
});
el("run-preview").addEventListener("click", async () => {
  el("status").textContent = "running preview workflow";
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: el("goal").value || "fix failing test", fixtureMode: true })
  });
  const payload = await response.json();
  selectedSession = payload.sessionId || "latest";
  await load();
});

load();

async function load() {
  el("status").textContent = "loading sessions";
  const sessions = await fetchJson("/api/sessions");
  el("sessions").innerHTML = sessions.map((session) => '<option value="' + esc(session.sessionId) + '">' + esc(session.sessionId) + '</option>').join("");
  if (sessions.length && !sessions.some((session) => session.sessionId === selectedSession)) selectedSession = sessions[0].sessionId;
  if (!sessions.length) {
    clearDashboard("No sessions yet. Click Run Preview to create a non-mutating fixture session.");
    return;
  }
  el("sessions").value = selectedSession;
  await loadSession(selectedSession);
}

async function loadSession(id) {
  el("status").textContent = "loading " + id;
  const record = await fetchJson("/api/sessions/" + encodeURIComponent(id));
  render(record.state || record);
  el("status").textContent = "ready";
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function render(state) {
  const events = state.events || [];
  const agents = state.agents || [];
  const routing = state.routing || {};
  const route = routing.assignments || [];
  const selected = selectedCandidate(state);
  const latestRun = (state.runResults || []).at(-1);

  el("mode").textContent = "MODE " + upper(state.access?.mode || "local");
  el("metric-task").textContent = state.goal || "-";
  el("metric-access").textContent = state.access?.mode || "-";
  el("metric-route").textContent = route.slice(0, 5).map((item) => item.provider).join(" / ") || "-";
  el("metric-events").textContent = String(events.length);
  el("metric-trace").textContent = String(state.traceCompleteness?.score ?? traceScore(events));

  el("agents").innerHTML = agents.map((agent) => row(agent.role, (agent.provider || "-") + " / " + (agent.model || "-"), agent.status || "ready")).join("") || empty("No agents recorded.");
  el("route").innerHTML = route.map((item) => row(item.role, (item.provider || "-") + " / " + (item.model || "-"), item.reason || "routed")).join("") || empty("No routing plan recorded.");
  el("diff").textContent = selected?.unifiedDiff || "No patch candidate captured.";
  el("decision").innerHTML = [
    row("review", state.review?.overallRecommendation || "not recorded", state.review ? "recorded" : "waiting"),
    row("judge", state.judge?.reason || state.judge?.decision || "not recorded", state.judge?.decision || "waiting"),
    row("shell", latestRun?.command || "not run", latestRun ? (latestRun.success ? "passed" : "failed") : "waiting")
  ].join("");
  el("diagnostics").innerHTML = [
    row("fallbacks", String(events.filter((event) => event.type === "fallback_to_native" || event.type === "provider_fallback").length), "count"),
    row("projection", String(events.filter((event) => event.type === "artifact_projection").length), "artifact views"),
    row("evidence", String(events.filter((event) => event.type === "evidence_packet").length), "packets"),
    row("budget", String(events.filter((event) => event.type === "budget_decision" || event.type === "cost_usage").length), "events"),
    row("stop", [...events].reverse().find((event) => event.type === "workflow_stop_reason")?.reason || "not recorded", "reason")
  ].join("");
  el("events").innerHTML = events.slice(-80).reverse().map(renderEvent).join("") || empty("No events recorded.");
}

function selectedCandidate(state) {
  const candidates = [...(state.candidates || []), ...(state.repairCandidates || [])];
  return candidates.find((candidate) => candidate.candidateId === state.judge?.selectedCandidateId) || candidates[0];
}

function traceScore(events) {
  const required = ["context_select", "patch_candidate", "review_decision", "judge_decision", "summary"];
  const present = new Set(events.map((event) => event.type));
  return Math.round(required.filter((type) => present.has(type)).length / required.length * 100);
}

function renderEvent(event) {
  return '<div class="event"><span>' + esc(timeOf(event)) + '</span><strong>' + esc(event.type || "event") + '</strong><div class="text">' + esc(eventSummary(event)) + '</div></div>';
}

function eventSummary(event) {
  return event.reason || event.summary || event.error || event.recommendation || event.decision || event.command || event.status || event.role || event.phase || "";
}

function row(label, text, status) {
  return '<div class="row"><span class="tag">' + esc(label) + '</span><span class="text">' + esc(text) + '</span><span class="' + statusClass(status) + '">' + esc(status) + '</span></div>';
}

function empty(message) {
  return '<div class="muted">' + esc(message) + '</div>';
}

function clearDashboard(message) {
  ["agents", "route", "decision", "diagnostics", "events"].forEach((id) => el(id).innerHTML = empty(message));
  el("diff").textContent = message;
  el("status").textContent = "ready";
}

function statusClass(value) {
  if (/fail|block|reject|abort|warn/i.test(String(value))) return "warn";
  return "ok";
}

function timeOf(event) {
  const value = event.timestamp || event.at || event.time;
  if (!value) return "now";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(11, 19);
}

function upper(value) { return String(value).toUpperCase(); }
function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}`;
}
