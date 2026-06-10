export function renderCockpitHtml(nonce = ""): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f7f7f3" />
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <title>TomorrowEdge GUI Client</title>
  <style>${cockpitCss()}</style>
</head>
<body>
  <main class="cockpit-shell">
    <header class="topbar">
      <div class="brand">
        <div class="mark" aria-hidden="true">
          <span class="mark-top"></span>
          <span class="mark-stem"></span>
          <span class="mark-trace"></span>
        </div>
        <div>
          <h1>TomorrowEdge GUI Client</h1>
          <span id="workspace">workspace</span>
        </div>
      </div>
      <div class="top-status">
        <span id="mode-chip" class="chip chip-blue">partial</span>
        <span id="session-chip" class="chip">session latest</span>
        <button id="run-top" class="quiet-run" title="Run current command">Run</button>
        <button id="refresh" class="icon-button" title="Refresh client state">Refresh</button>
      </div>
    </header>

    <section class="cockpit-grid">
      <aside class="task-panel panel" aria-label="Task queue">
        <div class="panel-head">
          <h2>Tasks</h2>
          <button class="ghost-button" id="new-task" title="New task">New</button>
        </div>
        <div class="task-filter">
          <select id="sessions" aria-label="session selector"></select>
        </div>
        <div id="tasks" class="task-list"></div>
      </aside>

      <section class="workflow-panel panel" aria-label="Workflow main area">
        <div class="panel-head">
          <h2>Workflow</h2>
          <div class="head-actions">
            <span id="status-text" class="chip chip-blue">ready</span>
            <button id="open-drawer" class="ghost-button">Details</button>
          </div>
        </div>
        <div id="workflow-spine" class="workflow-spine"></div>
        <article id="main-view" class="main-view"></article>
      </section>

      <aside class="telemetry-panel panel" aria-label="Telemetry">
        <div class="panel-head">
          <h2>Telemetry</h2>
          <span id="fallback-chip" class="chip">fallback 0</span>
        </div>
        <div id="telemetry" class="telemetry"></div>
      </aside>
    </section>

    <section id="trace-sheet" class="trace-sheet" aria-label="Trace Ledger">
      <div class="trace-title">
        <strong>Trace</strong>
        <span id="trace-count" class="chip">0 events</span>
      </div>
      <div id="trace-strip" class="trace-strip"></div>
    </section>

    <section class="composer panel" aria-label="Natural language command">
      <div class="composer-label">Command</div>
      <textarea id="goal" rows="1" placeholder="Describe a task, constraint, or approval feedback..."></textarea>
      <div class="composer-controls">
        <select id="access-mode" title="Access mode">
          <option value="partial">partial</option>
          <option value="restricted">restricted</option>
          <option value="full">full</option>
        </select>
        <select id="target" title="Target role">
          <option value="core">target: core</option>
          <option value="planner">target: planner</option>
          <option value="reviewer">target: reviewer</option>
          <option value="judge">target: judge</option>
          <option value="debate">target: debate</option>
        </select>
        <label class="check"><input id="fixture-mode" type="checkbox" checked /> fixture</label>
        <label class="check quiet-optional"><input id="approve-patch" type="checkbox" /> patch</label>
        <label class="check quiet-optional"><input id="approve-shell" type="checkbox" /> shell</label>
        <button id="run" class="primary-button">Send</button>
      </div>
    </section>
  </main>

  <aside id="drawer" class="drawer" aria-label="Details drawer">
    <div class="drawer-head">
      <strong>Details</strong>
      <button id="close-drawer" class="ghost-button">Close</button>
    </div>
    <div id="drawer-content"></div>
  </aside>
  <script>${cockpitJs(nonce)}</script>
</body>
</html>`;
}

function cockpitCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f6fafc;
  --surface: #ffffff;
  --alt: #eef5f8;
  --border: #d7e4ea;
  --border-strong: #b8cbd5;
  --text: #17212b;
  --muted: #6b7a88;
  --blue: #6fafd2;
  --deep-blue: #2f6f92;
  --success: #2f9d68;
  --warning: #b7791f;
  --danger: #c94a4a;
  --mono: "Cascadia Mono", "JetBrains Mono", Consolas, monospace;
  --sans: Inter, "Segoe UI", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #10161c;
    --surface: #151d24;
    --alt: #1c2730;
    --border: #2d3b46;
    --border-strong: #42515c;
    --text: #e7eef4;
    --muted: #93a4b3;
    --blue: #79b8dc;
    --deep-blue: #9fcfe9;
    --success: #66c98f;
    --warning: #e0b15a;
    --danger: #ef7f7f;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  letter-spacing: 0;
}
button, select, textarea {
  font: inherit;
}
.cockpit-shell {
  height: 100vh;
  min-width: 0;
  display: grid;
  grid-template-rows: 46px minmax(0, 1fr) 36px 82px;
  overflow: hidden;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.92);
}
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mark {
  position: relative;
  width: 34px;
  height: 26px;
  flex: 0 0 auto;
}
.mark-top {
  position: absolute;
  left: 0;
  top: 2px;
  width: 34px;
  height: 8px;
  background: #d81f0d;
  clip-path: polygon(8px 0, 34px 0, 26px 8px, 0 8px);
}
.mark-stem {
  position: absolute;
  left: 15px;
  top: 11px;
  width: 11px;
  height: 15px;
  background: #050505;
  clip-path: polygon(0 0, 11px 5px, 11px 12px, 0 15px);
}
.mark-trace {
  position: absolute;
  left: 4px;
  bottom: 0;
  width: 14px;
  height: 2px;
  background: var(--blue);
}
h1, h2, p { margin: 0; }
h1 { font-size: 15px; line-height: 1.1; }
.brand span { color: var(--muted); font-family: var(--mono); font-size: 11px; }
.top-status { display: flex; align-items: center; gap: 8px; min-width: 0; }
.cockpit-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(220px, 19.5%) minmax(560px, 1fr) minmax(230px, 20.5%);
  gap: 10px;
  padding: 10px;
}
.panel {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  min-width: 0;
  overflow: hidden;
}
.panel-head {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, #ffffff, #f8fbfd);
}
.panel-head h2 { font-size: 15px; }
.head-actions { display: flex; align-items: center; gap: 8px; }
.ghost-button, .icon-button {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--deep-blue);
  border-radius: 5px;
  min-height: 28px;
  padding: 5px 9px;
  cursor: pointer;
}
.ghost-button:hover, .icon-button:hover { border-color: var(--blue); }
.quiet-run {
  border: 1px solid #c7d9e2;
  background: #f8fcfe;
  color: var(--deep-blue);
  border-radius: 5px;
  min-height: 26px;
  padding: 4px 11px;
  cursor: pointer;
}
.primary-button {
  border: 1px solid #bdd5e1;
  background: #f7fbfd;
  color: var(--deep-blue);
  border-radius: 5px;
  min-height: 34px;
  padding: 6px 16px;
  cursor: pointer;
}
.chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--muted);
  background: #fff;
  font: 11px var(--mono);
  white-space: nowrap;
}
.chip-blue { border-color: #b9d7e8; color: var(--deep-blue); background: #eaf5fb; }
.chip-green { border-color: #bfe2cf; color: var(--success); background: #f0faf4; }
.chip-amber { border-color: #ead6a8; color: var(--warning); background: #fff9eb; }
.chip-red { border-color: #efc2c2; color: var(--danger); background: #fff4f4; }
.task-panel, .telemetry-panel, .workflow-panel { min-height: 0; }
.task-filter { padding: 8px 12px; border-bottom: 1px solid rgba(215, 228, 234, 0.55); }
select, textarea {
  border: 1px solid var(--border);
  border-radius: 5px;
  background: #fff;
  color: var(--text);
}
select { min-height: 30px; padding: 4px 8px; }
#sessions { width: 100%; }
.task-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  overflow: auto;
  height: calc(100% - 92px);
}
.task-item {
  border: 1px solid transparent;
  border-bottom-color: rgba(215, 228, 234, 0.62);
  border-radius: 4px;
  padding: 8px 7px;
  display: grid;
  gap: 4px;
  background: transparent;
}
.task-item.selected { border-color: rgba(111, 175, 210, 0.36); background: rgba(238, 245, 248, 0.52); }
.task-title { display: flex; justify-content: space-between; gap: 8px; font-weight: 620; font-size: 12.5px; }
.task-title span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-meta { display: flex; justify-content: space-between; color: var(--muted); font: 10.5px var(--mono); }
.workflow-panel {
  display: grid;
  grid-template-rows: 44px 72px minmax(0, 1fr) auto;
}
.workflow-spine {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  padding: 10px 14px 8px;
  border-bottom: 1px solid var(--border);
  background: #fbfdfe;
}
.step {
  min-width: 0;
  display: grid;
  gap: 4px;
  justify-items: center;
  color: var(--muted);
  font: 11px var(--mono);
  position: relative;
}
.step strong { font-weight: 620; color: #334657; }
.step span:last-child { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.72; }
.step::before {
  content: "";
  width: 100%;
  height: 1px;
  background: var(--border-strong);
  position: absolute;
  top: 10px;
  left: -50%;
  z-index: 0;
}
.step:first-child::before { display: none; }
.dot {
  z-index: 1;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #fff;
  border: 1px solid var(--border-strong);
}
.step.done .dot { border-color: #8bc9a7; background: #f0faf4; color: var(--success); }
.step.running .dot, .step.waiting .dot { border-color: var(--deep-blue); background: var(--deep-blue); color: #fff; }
.step.failed .dot { border-color: var(--danger); background: #fff4f4; color: var(--danger); }
.main-view {
  min-height: 0;
  overflow: auto;
  padding: 14px;
}
.main-grid {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 12px;
  height: 100%;
}
.summary-box, .diff-box, .review-box {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
}
.summary-box { padding: 12px; }
.summary-box h3 { margin: 0 0 10px; font-size: 15px; }
.summary-box dl { margin: 0; display: grid; gap: 10px; font-size: 12px; }
.summary-box dt { color: var(--muted); }
.summary-box dd { margin: 2px 0 0; font-family: var(--mono); }
.diff-box pre, .body-pre {
  margin: 0;
  padding: 12px;
  min-height: 260px;
  max-height: calc(100vh - 360px);
  overflow: auto;
  white-space: pre-wrap;
  font: 12px/1.5 var(--mono);
  color: #203040;
}
.diff-add { color: var(--success); }
.diff-del { color: var(--danger); }
.approval-focus {
  max-width: 720px;
  margin: 8px auto 0;
  padding: 26px 28px;
  border: 1px solid rgba(111, 175, 210, 0.38);
  border-radius: 6px;
  background: linear-gradient(180deg, #ffffff, #f9fcfe);
}
.approval-kicker { color: var(--muted); font: 11px var(--mono); margin-bottom: 10px; }
.approval-focus h3 { margin: 0 0 8px; font-size: 19px; }
.approval-stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
.approval-summary { color: #394b5b; line-height: 1.55; font-size: 13px; }
.approval-actions {
  display: flex;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}
.danger-button {
  border: 1px solid #e4a6a6;
  background: #fff;
  color: var(--danger);
  border-radius: 5px;
  min-height: 32px;
  padding: 6px 16px;
  cursor: pointer;
}
.telemetry {
  padding: 12px;
  display: grid;
  gap: 9px;
  overflow: auto;
  height: calc(100% - 44px);
}
.metric-line {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 2px;
  border-bottom: 1px solid rgba(215, 228, 234, 0.55);
}
.metric-line span { color: var(--muted); font-size: 12px; }
.metric-line strong { font: 13px var(--mono); font-weight: 620; text-align: right; }
.telemetry-details {
  margin-top: 4px;
  color: var(--deep-blue);
  font: 11px var(--mono);
  text-align: right;
}
.trace-sheet {
  margin: 0 10px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  align-items: center;
  padding: 5px 10px;
  min-height: 0;
}
.trace-title { display: flex; align-items: center; gap: 8px; }
.trace-strip {
  min-width: 0;
  display: flex;
  gap: 8px;
  overflow: hidden;
  font: 11px var(--mono);
  color: var(--muted);
}
.trace-event {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trace-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--blue);
  flex: 0 0 auto;
}
.composer {
  margin: 0 10px 10px;
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
}
.composer-label { font-weight: 620; font-size: 13px; }
textarea {
  width: 100%;
  resize: none;
  padding: 8px 10px;
  line-height: 1.35;
  min-height: 36px;
}
.composer-controls { display: flex; align-items: center; gap: 6px; }
.check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font: 11px var(--mono);
  white-space: nowrap;
}
.quiet-optional { opacity: 0.62; }
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: min(520px, calc(100vw - 28px));
  max-width: calc(100vw - 28px);
  height: 100vh;
  background: #fff;
  border-left: 1px solid var(--border);
  box-shadow: -20px 0 50px rgba(45, 70, 90, 0.12);
  transform: translateX(100%);
  transition: transform 160ms ease;
  z-index: 50;
}
.drawer.open { transform: translateX(0); }
.drawer-head {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}
#drawer-content { padding: 14px; overflow: auto; height: calc(100vh - 52px); }
.muted { color: var(--muted); }
.mono { font-family: var(--mono); }
@media (prefers-color-scheme: dark) {
  .topbar,
  .panel,
  .task-card,
  .main-view,
  .approval-focus,
  .telemetry-card,
  .trace-sheet,
  .composer,
  .drawer,
  .drawer header,
  button,
  select,
  textarea,
  input {
    background: var(--surface);
    color: var(--text);
  }
  .panel > header,
  .workflow-spine,
  .route-summary,
  .diff-box,
  .body-pre {
    background: var(--alt);
  }
  .chip-blue,
  .chip-green,
  .chip-amber,
  .chip-red {
    background: transparent;
  }
}
@media (max-width: 1180px) {
  .cockpit-grid { grid-template-columns: minmax(220px, 24%) minmax(0, 1fr) minmax(220px, 24%); }
  .composer { grid-template-columns: 96px minmax(0, 1fr); }
  .composer-controls { grid-column: 2; justify-content: flex-end; }
  .drawer { width: min(460px, calc(100vw - 18px)); max-width: calc(100vw - 18px); }
}
@media (max-width: 860px) {
  body { overflow-x: hidden; }
  .cockpit-shell {
    min-width: 0;
    height: auto;
    min-height: 100vh;
    grid-template-rows: auto auto auto auto;
    overflow: visible;
  }
  .topbar {
    flex-wrap: wrap;
    align-items: flex-start;
    padding: 8px 10px;
  }
  .top-status {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .cockpit-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    padding: 8px;
  }
  .task-list {
    height: auto;
    max-height: 220px;
  }
  .workflow-panel {
    grid-template-rows: auto auto minmax(360px, auto);
  }
  .workflow-spine {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .main-grid {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
  }
  .main-view {
    overflow: visible;
  }
  .approval-focus {
    max-width: none;
    margin: 0;
    padding: 18px;
  }
  .diff-box pre, .body-pre {
    max-height: none;
    min-height: 180px;
  }
  .telemetry {
    height: auto;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .trace-sheet {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    align-items: stretch;
    margin: 0 8px 8px;
  }
  .trace-strip {
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .composer {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
    margin: 0 8px 8px;
  }
  .composer-controls {
    grid-column: 1;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .drawer {
    width: min(100vw, 460px);
    max-width: 100vw;
  }
}
@media (max-width: 520px) {
  .workflow-spine {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .telemetry {
    grid-template-columns: minmax(0, 1fr);
  }
  .top-status > * {
    flex: 0 1 auto;
  }
  .composer-controls select,
  .composer-controls button {
    flex: 1 1 132px;
  }
}`;
}
function cockpitJs(nonce = ""): string {
  return `
const el = (id) => document.getElementById(id);
const nonce = window.__TOMORROWEDGE_COCKPIT__?.nonce || ${JSON.stringify(nonce)};
let selectedSession = "latest";
let currentVm = null;
let liveSource = null;
let liveEventsBuffer = [];
let liveReloadTimer = null;

el("refresh").addEventListener("click", () => load());
el("run-top").addEventListener("click", runWorkflow);
el("new-task").addEventListener("click", () => {
  selectedSession = "latest";
  renderEmpty("Ready for a new task.");
  el("goal").focus();
});
el("sessions").addEventListener("change", (event) => {
  selectedSession = event.target.value || "latest";
  loadViewModel(selectedSession);
});
el("run").addEventListener("click", runWorkflow);
el("goal").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!el("run").disabled) void runWorkflow();
});
el("open-drawer").addEventListener("click", () => renderDrawer(true));
el("close-drawer").addEventListener("click", () => el("drawer").classList.remove("open"));

load();

async function load() {
  const sessions = await fetchJson("/api/sessions").catch(() => []);
  el("sessions").innerHTML = sessions.length
    ? sessions.map((session) => '<option value="' + esc(session.sessionId) + '">' + esc(session.sessionId) + '</option>').join("")
    : '<option value="latest">latest</option>';
  if (sessions.length && !sessions.some((session) => session.sessionId === selectedSession)) selectedSession = sessions[0].sessionId;
  el("sessions").value = selectedSession;
  if (sessions.length) await loadViewModel(selectedSession);
  else renderEmpty("No sessions yet. Describe a task and click Send.");
}

async function loadViewModel(id) {
  const vm = await fetchJson("/api/sessions/" + encodeURIComponent(id) + "/view-model");
  currentVm = vm;
  render(vm);
}

async function runWorkflow() {
  const goal = el("goal").value.trim();
  if (!goal) {
    renderEmpty("Describe a task before starting a workflow.");
    return;
  }
  el("run").disabled = true;
  renderEmpty("Task submitted. Waiting for live events...");
  const response = await fetch(withToken("/api/runs"), {
    method: "POST",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      goal,
      accessMode: el("access-mode").value,
      fixtureMode: el("fixture-mode").checked,
      approvePatch: el("approve-patch").checked,
      approveShell: el("approve-shell").checked,
      to: el("target").value
    })
  });
  const payload = await response.json();
  selectedSession = payload.sessionId || "latest";
  connectLive(selectedSession);
}

function connectLive(sessionId) {
  if (liveSource) liveSource.close();
  liveEventsBuffer = [];
  liveSource = new EventSource(withToken("/api/runs/" + encodeURIComponent(sessionId) + "/events/live"));
  liveSource.addEventListener("event", (message) => {
    const payload = JSON.parse(message.data);
    if (payload.event) liveEventsBuffer.push(payload.event);
    renderLiveEvents(sessionId, liveEventsBuffer);
    scheduleLiveViewModelRefresh(sessionId);
  });
  liveSource.addEventListener("snapshot", (message) => {
    const payload = JSON.parse(message.data);
    if (payload.viewModel) {
      render(payload.viewModel);
    } else if (payload.snapshot?.state) {
      loadViewModel(payload.snapshot.sessionId || sessionId).catch(() => load());
    }
    if (payload.snapshot?.done) {
      liveSource.close();
      el("run").disabled = false;
    }
  });
  liveSource.onerror = () => {
    el("run").disabled = false;
  };
}

function scheduleLiveViewModelRefresh(sessionId) {
  clearTimeout(liveReloadTimer);
  liveReloadTimer = setTimeout(async () => {
    try {
      await loadViewModel(sessionId);
    } catch {
      // The session is persisted at workflow checkpoints; keep the trace strip live meanwhile.
    }
  }, 250);
}

function render(vm) {
  el("workspace").textContent = vm.workspace || "workspace";
  el("mode-chip").textContent = modeLabel(vm.accessMode);
  el("mode-chip").className = "chip " + (vm.accessMode === "full" ? "chip-blue" : vm.accessMode === "restricted" ? "chip-amber" : "chip-blue");
  el("session-chip").textContent = vm.sessionId ? "session " + vm.sessionId.slice(0, 12) : "session -";
  el("status-text").textContent = vm.statusText;
  el("fallback-chip").textContent = "fallback " + vm.telemetry.fallbackCount;

  el("tasks").innerHTML = vm.tasks.map(renderTask).join("");
  el("workflow-spine").innerHTML = vm.workflow.map(renderStep).join("");
  el("main-view").innerHTML = renderMain(vm);
  el("telemetry").innerHTML = renderTelemetry(vm.telemetry);
  el("trace-count").textContent = vm.trace.length + " events";
  el("trace-strip").innerHTML = vm.trace.slice(0, 18).map(renderTrace).join("");
  renderDrawer(el("drawer").classList.contains("open"));
  bindApprovalButtons(vm.currentApproval);
  bindDrawerButtons();
}

function renderEmpty(message) {
  currentVm = null;
  el("workspace").textContent = "GUI Client";
  el("status-text").textContent = message;
  el("tasks").innerHTML = '<div class="task-item selected"><div class="task-title"><span>New task</span><span class="chip chip-blue">idle</span></div><div class="task-meta"><span>enter a command</span><span>now</span></div></div>';
  el("workflow-spine").innerHTML = ["Plan","Route","Edit","Review","Test","Judge","Approve"].map((label) => '<div class="step"><span class="dot"></span><strong>' + label + '</strong></div>').join("");
  el("main-view").innerHTML = '<div class="summary-box"><h3>' + esc(message) + '</h3><pre class="body-pre">Use the command composer for tasks, constraints, and approval feedback. TomorrowEdge creates a session, records the event ledger, and streams live workflow state into this client.</pre></div>';
  el("telemetry").innerHTML = renderTelemetry({ plannerModel:"-", coderModel:"-", reviewerModel:"-", judgeModel:"-", providerSummary:"offline", inputTokens:0, outputTokens:0, totalTokens:0, dispatched:0, running:0, completed:0, waiting:0, failed:0, patchWaiting:false, shellWaiting:false, fallbackCount:0, realBudgetDecisions:0, simulatedBudgetDecisions:0 });
  el("trace-count").textContent = "0 events";
  el("trace-strip").innerHTML = "";
}

function renderLiveEvents(sessionId, events) {
  el("session-chip").textContent = "session " + sessionId.slice(0, 12);
  el("status-text").textContent = "Running";
  el("trace-count").textContent = events.length + " events";
  el("trace-strip").innerHTML = events.slice(-18).reverse().map(renderTrace).join("");
  const latest = events.at(-1);
  if (latest && !currentVm) {
    el("main-view").innerHTML = '<div class="summary-box"><h3>Live workflow</h3><pre class="body-pre">' + esc(events.slice(-14).map((event) => '[' + event.phase + '] ' + event.type + ' ' + eventSummary(event)).join("\\n")) + '</pre></div>';
  }
}

function renderTask(task) {
  return '<article class="task-item ' + (task.selected ? "selected" : "") + '"><div class="task-title"><span>' + esc(task.title) + '</span>' + chip(task.status) + '</div><div class="task-meta"><span>' + esc(task.reminder) + '</span><span>' + shortTime(task.updatedAt) + '</span></div></article>';
}

function renderStep(step) {
  return '<div class="step ' + esc(step.status) + '"><span class="dot">' + dotText(step.status) + '</span><strong>' + esc(step.label) + '</strong><span>' + esc(step.summary).slice(0, 22) + '</span></div>';
}

function renderMain(vm) {
  const main = vm.main;
  if (vm.currentApproval) {
    const approval = vm.currentApproval;
    const title = approval.kind === "shell" ? "Waiting for shell approval" : "Waiting for patch approval";
    return '<section class="approval-focus"><div class="approval-kicker">Approval · summary-first</div><h3>' + title + '</h3><p class="muted mono">' + esc(approval.candidateId || approval.command || "candidate") + '</p><div class="approval-stats">' +
      chip((approval.filesChanged?.length || 0) + " file") +
      chip(changeCount(approval.diff)) +
      chip("risk " + (approval.riskLevel || "low")) +
      chip("tests " + (approval.testStatus || "not_run")) +
      '</div><p class="approval-summary">' + esc(approval.summary || main.body || "Waiting for operator authorization.") + '</p><p class="muted mono">Full diff, routes, telemetry, artifacts, and raw trace are in the details drawer.</p>' +
      renderApprovalActions(approval) + '</section>';
  }
  const diff = main.diff ? renderDiff(main.diff) : '<pre class="body-pre">' + esc(main.body || "No details yet.") + '</pre>';
  return '<div class="main-grid"><aside class="summary-box"><h3>' + esc(main.title) + '</h3><dl><div><dt>Stage</dt><dd>' + esc(vm.statusText) + '</dd></div><div><dt>Target</dt><dd>' + esc(main.subtitle) + '</dd></div><div><dt>Files</dt><dd>' + esc(main.filesChanged.join(", ") || "-") + '</dd></div><div><dt>Risk</dt><dd>' + chip(main.riskLevel || "low") + '</dd></div><div><dt>Tests</dt><dd>' + chip(main.testStatus || "not_run") + '</dd></div></dl></aside><section class="diff-box">' + diff + '</section></div>';
}
function renderDiff(diff) {
  return '<pre>' + esc(diff).split("\\n").map((line) => {
    const cls = line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-del" : "";
    return '<span class="' + cls + '">' + line + '</span>';
  }).join("\\n") + '</pre>';
}

function renderApprovalActions(approval) {
  if (!approval || approval.status !== "waiting") return '<div class="approval-actions"><button class="ghost-button" data-action="request_re_review">Request re-review</button><button class="ghost-button" data-drawer-action="open">View details</button></div>';
  if (approval.kind === "shell") {
    return '<div class="approval-actions"><button class="primary-button" data-action="approve_shell">Approve shell</button><button class="danger-button" data-action="reject_shell">Reject</button><button class="ghost-button" data-action="request_re_review">Re-review</button><button class="ghost-button" data-action="undo_latest_patch">Undo latest patch</button><button class="ghost-button" data-drawer-action="open">View diff</button></div>';
  }
  return '<div class="approval-actions"><button class="primary-button" data-action="approve_patch">Approve</button><button class="danger-button" data-action="reject_patch">Reject</button><button class="ghost-button" data-action="request_re_review">Re-review</button><button class="ghost-button" data-drawer-action="open">View diff</button></div>';
}

function bindApprovalButtons(approval) {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!currentVm?.sessionId) return;
      button.disabled = true;
      const response = await fetch(withToken("/api/approvals"), {
        method: "POST",
        headers: apiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: button.dataset.action, sessionId: currentVm.sessionId, approvalId: approval?.id, feedback: el("goal").value })
      });
      const payload = await response.json();
      if (payload.viewModel) render(payload.viewModel);
      else await loadViewModel(currentVm.sessionId);
    });
  });
}

function bindDrawerButtons() {
  document.querySelectorAll("[data-drawer-action]").forEach((button) => {
    button.addEventListener("click", () => renderDrawer(true));
  });
}

function renderTelemetry(t) {
  return metric("Cost", money(t.currentCostUsd) + " / " + money(t.budgetUsd)) +
    metric("Tokens", measuredNumber(t.totalTokens)) +
    metric("Cache", typeof t.cacheHitPercent === "number" ? t.cacheHitPercent + "%" : "-") +
    metric("Agents", t.completed + " done · " + t.waiting + " waiting") +
    metric("Budget calls", "real " + (t.realBudgetDecisions || 0) + " / sim " + (t.simulatedBudgetDecisions || 0)) +
    metric("Latency", t.latencyMs ? formatDuration(t.latencyMs) : "-") +
    metric("Risk", t.latestRiskLevel || "-") +
    '<div class="telemetry-details">details &gt;</div>';
}

function renderTrace(event) {
  return '<span class="trace-event" title="' + esc(event.summary || "") + '"><span class="trace-dot"></span><span>' + esc(event.phase || "") + ':' + esc(event.type || "") + '</span></span>';
}

function renderDrawer(open) {
  const drawer = el("drawer");
  if (open) drawer.classList.add("open");
  if (!currentVm) {
    el("drawer-content").innerHTML = '<p class="muted">No details yet.</p>';
    return;
  }
  el("drawer-content").innerHTML =
    '<h3>Full diff</h3><pre class="body-pre">' + esc(currentVm.main.diff || currentVm.currentApproval?.diff || "No diff in the current main view.") + '</pre>' +
    '<h3>Changed files</h3><pre class="body-pre">' + esc(currentVm.main.filesChanged.join("\\n") || "-") + '</pre>' +
    '<h3>Telemetry details</h3><pre class="body-pre">' + esc(JSON.stringify(currentVm.telemetry, null, 2)) + '</pre>' +
    '<h3>Routes</h3><pre class="body-pre">' + esc(currentVm.routes.map((route) => route.role + " -> " + route.provider + "/" + route.model + " because " + route.reason).join("\\n")) + '</pre>' +
    '<h3>Memory influence</h3><pre class="body-pre">' + esc(currentVm.memoryInfluence ? JSON.stringify(currentVm.memoryInfluence, null, 2) : "-") + '</pre>' +
    '<h3>Error-loop timeline</h3><pre class="body-pre">' + esc(currentVm.errorLoopTimeline ? JSON.stringify(currentVm.errorLoopTimeline, null, 2) : "-") + '</pre>' +
    '<h3>Artifacts</h3><pre class="body-pre">' + esc(currentVm.artifacts.slice(0, 40).map((item) => item.ref).join("\\n") || "-") + '</pre>' +
    '<h3>Raw event trace</h3><pre class="body-pre">' + esc(JSON.stringify(currentVm.rawEvents || currentVm.trace, null, 2)) + '</pre>';
}

async function fetchJson(url) {
  const response = await fetch(withToken(url), { headers: apiHeaders() });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
function withToken(url) {
  return url;
}
function apiHeaders(extra = {}) {
  return nonce ? { ...extra, "x-tomorrowedge-token": nonce } : extra;
}
function metric(a, b) { return '<div class="metric-line"><span>' + esc(a) + '</span><strong>' + esc(b) + '</strong></div>'; }
function changeCount(diff) {
  if (!diff) return "0 / 0";
  const lines = diff.split("\\n");
  const add = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const del = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  return "+" + add + " / -" + del;
}
function compactNumber(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "m";
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return String(n);
}
function measuredNumber(value) {
  const n = Number(value || 0);
  return n > 0 ? compactNumber(n) : "not measured";
}
function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return seconds + "s";
  return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
}
function chip(value) {
  const text = String(value ?? "-");
  const cls = /fail|reject|failed/.test(text) ? "chip-red" : /wait|approval|not_run|pending/.test(text) ? "chip-amber" : /done|pass|success|approved|low/.test(text) ? "chip-green" : "chip-blue";
  return '<span class="chip ' + cls + '">' + esc(text) + '</span>';
}
function dotText(status) { return status === "done" ? "ok" : status === "failed" ? "!" : status === "running" || status === "waiting" ? ">" : ""; }
function eventSummary(event) { return event.summary || event.reason || event.command || event.recommendation || event.decision || event.status || event.role || ""; }
function modeLabel(mode) { return mode === "full" ? "FULL AUTONOMY" : mode === "restricted" ? "restricted" : "partial"; }
function money(value) { return typeof value === "number" && value > 0 ? "$" + value.toFixed(4) : "not measured"; }
function number(value) { return Number(value || 0).toLocaleString(); }
function shortTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || "-") : date.toISOString().slice(11, 16);
}
function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}`;
}
