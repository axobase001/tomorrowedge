import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { App } from "../../src/cockpit-web/src/App.js";
import { roleProviderOptions } from "../../src/cockpit-web/src/components/KeyRoleManager.js";
import { TaskListPanel } from "../../src/cockpit-web/src/components/TaskListPanel.js";
import { createTranslator, type GuiLanguage } from "../../src/cockpit-web/src/i18n.js";
import { buildCockpitRunRequest } from "../../src/cockpit-web/src/runRequest.js";
import type { CockpitViewModel } from "../../src/cockpit/contracts.js";
import { renderCockpitHtml } from "../../src/localCockpit/html.js";

describe("cockpit web React surface", () => {
  it("renders the geometric brand mark instead of the legacy text tile", () => {
    const html = renderApp(sampleViewModel());

    expect(html).toContain("te-mark-top");
    expect(html).toContain("te-mark-stem");
    expect(html).toContain("te-mark-trace");
    expect(html).not.toContain(">T</span>");
  });

  it("renders wired approval and drawer controls", () => {
    const html = renderApp({
      ...sampleViewModel(),
      currentApproval: {
        id: "patch:candidate_a",
        kind: "patch",
        title: "Waiting for patch approval",
        status: "waiting",
        candidateId: "candidate_a",
        filesChanged: ["index.js"],
        riskLevel: "low",
        testStatus: "not_run",
        summary: "Patch candidate needs approval.",
        diff: "--- a/index.js\n+++ b/index.js"
      }
    });

    expect(html).toContain("Waiting for patch approval");
    expect(html).toContain("data-testid=\"approval-approve\"");
    expect(html).toContain("data-testid=\"approval-reject\"");
    expect(html).toContain("data-testid=\"approval-open-drawer\"");
    expect(html).toContain("te-drawer open");
  });

  it("shows composer connection status without clearing the controlled goal", () => {
    const html = renderApp(sampleViewModel(), { goal: "run a smoke task", statusMessage: "Workflow running..." });

    expect(html).toContain("run a smoke task");
    expect(html).toContain("Workflow running...");
    expect(html).toContain("target: core");
    expect(html).toContain("data-testid=\"composer-input\"");
    expect(html).toContain("data-testid=\"composer-mode\"");
    expect(html).toContain("partial");
  });

  it("enables repair loops for full-mode GUI runs", () => {
    expect(buildCockpitRunRequest({ goal: "fix failing test", accessMode: "full", setupReady: true })).toMatchObject({
      accessMode: "full",
      fixtureMode: false,
      livePatch: true,
      liveAdvisory: true,
      repairOnFail: true,
      approveRepair: true,
      to: "core"
    });
  });

  it("keeps partial GUI runs supervised without auto repair approval", () => {
    expect(buildCockpitRunRequest({ goal: "fix failing test", accessMode: "partial", setupReady: true })).toMatchObject({
      accessMode: "partial",
      repairOnFail: false,
      approveRepair: false
    });
  });

  it("renders the first-run setup wizard with provider and model controls", () => {
    const html = renderApp(sampleViewModel(), { setupVisible: true });

    expect(html).toContain("First-run setup");
    expect(html).toContain("data-testid=\"setup-provider\"");
    expect(html).toContain("data-testid=\"setup-model\"");
    expect(html).toContain("data-testid=\"setup-base-url\"");
    expect(html).toContain("moonshotai/kimi-k2:free");
  });

  it("renders the API key and role manager from the topbar entry", () => {
    const closed = renderApp(sampleViewModel());
    const open = renderApp(sampleViewModel(), { keyManagerOpen: true });

    expect(closed).toContain("data-testid=\"topbar-keys\"");
    expect(open).toContain("API keys and role routing");
    expect(open).toContain("data-testid=\"key-role-manager\"");
    expect(open).toContain("data-testid=\"keymgr-base-url\"");
    expect(open).toContain("data-testid=\"keymgr-save-key\"");
    expect(open).toContain("data-testid=\"keymgr-tab-roles\"");
  });

  it("renders the role assignment tab entry in the key manager", () => {
    const html = renderApp(sampleViewModel(), { keyManagerOpen: true });

    expect(html).toContain("data-testid=\"keymgr-tab-roles\"");
    expect(html).toContain("Role Assign");
  });

  it("offers configured external agents as GUI role providers", () => {
    expect(roleProviderOptions(["openrouter"], [{
      id: "codex",
      provider: "external:codex",
      name: "Codex",
      roles: ["reviewer"],
      capabilities: ["review"]
    }], "auto")).toEqual(["auto", "openrouter", "external:codex"]);
  });

  it("renders shared session source and fixture metadata", () => {
    const html = renderApp(sampleViewModel());

    expect(html).toContain("Saved session");
    expect(html).toContain("Not connected");
    expect(html).toContain("Fixture");
    expect(html).toContain("Snapshot");
  });

  it("defaults the GUI language surface to English", () => {
    const html = renderApp(sampleViewModel());

    expect(html).toContain("data-testid=\"language-selector\"");
    expect(html).toContain("Language");
    expect(html).toContain("Command");
    expect(html).toContain("Telemetry");
  });

  it("renders the GUI chrome in Chinese when selected", () => {
    const html = renderApp(sampleViewModel(), { language: "zh", setupVisible: true, keyManagerOpen: true });

    expect(html).toContain("语言");
    expect(html).toContain("任务");
    expect(html).toContain("命令");
    expect(html).toContain("密钥与角色管理");
    expect(html).toContain("至少连接一个模型");
  });

  it("keeps a newly selected session visible before the session list refreshes", () => {
    const html = renderToStaticMarkup(
      React.createElement(TaskListPanel, {
        tasks: [],
        sessions: [],
        selectedSession: "session_new",
        t: createTranslator("en"),
        onSelectSession: () => undefined,
        onNewTask: () => undefined
      })
    );

    expect(html).toContain('<option value="session_new" selected="">session_new</option>');
    expect(html).not.toContain('<option value="latest"');
  });

  it("renders approval history in the detail drawer", () => {
    const html = renderApp(sampleViewModel());

    expect(html).toContain("Approval history");
    expect(html).toContain("patch:fixture_candidate_a");
    expect(html).toContain("filters=patch, pending");
  });

  it("renders routing reasons in the detail drawer", () => {
    const html = renderApp({
      ...sampleViewModel(),
      routes: [{ role: "planner", provider: "fixture", model: "fixture-scripted", reason: "high-risk plan needs conservative review" }]
    });

    expect(html).toContain("planner -&gt; fixture/fixture-scripted");
    expect(html).toContain("because high-risk plan needs conservative review");
  });

  it("renders capability dashboard readiness in the detail drawer", () => {
    const html = renderApp(sampleViewModel());

    expect(html).toContain("Capability dashboard");
    expect(html).toContain("Provider routing and model availability");
    expect(html).toContain("[available]");
  });

  it("keeps GUI CSS dark-mode aware and avoids fallback hard min-width locks", () => {
    const tokens = readFileSync(path.join(process.cwd(), "src", "cockpit-web", "src", "theme", "tokens.css"), "utf8");
    const fallback = renderCockpitHtml();

    expect(tokens).toContain("prefers-color-scheme: dark");
    expect(fallback).toContain("prefers-color-scheme: dark");
    expect(fallback).not.toContain("min-width: 1080px");
    expect(fallback).not.toContain("min-width: 980px");
  });
});

function renderApp(viewModel: CockpitViewModel, overrides: Partial<{ goal: string; statusMessage: string; setupVisible: boolean; keyManagerOpen: boolean; language: GuiLanguage }> = {}): string {
  const language = overrides.language ?? "en";
  const t = createTranslator(language);
  return renderToStaticMarkup(
    React.createElement(App, {
      viewModel,
      sessions: [{ sessionId: "session_test", createdAt: "2026-06-07T00:00:00.000Z", eventCount: 1, artifactCount: 0, goal: "test" }],
      selectedSession: "session_test",
      goal: overrides.goal ?? "",
      accessMode: "partial",
      busy: false,
      statusMessage: overrides.statusMessage,
      setupStatus: {
        needsSetup: true,
        recommendedProvider: "openrouter",
        configPath: ".tomorrowedge/config.yaml",
        providers: [{
          id: "openrouter",
          enabled: false,
          model: "",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKeyEnv: "OPENROUTER_API_KEY",
          keyConfigured: false,
          keySource: "missing",
          authRequired: true
        }, {
          id: "deepseek",
          enabled: false,
          model: "deepseek-chat",
          baseUrl: "https://api.deepseek.com/v1",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          keyConfigured: false,
          keySource: "missing",
          authRequired: true
        }],
        externalAgents: [],
        roleAssignments: [
          { role: "planner", provider: "openrouter", model: "moonshotai/kimi-k2:free" },
          { role: "reviewer", provider: "deepseek", model: "deepseek-chat" }
        ]
      },
      setupVisible: overrides.setupVisible ?? false,
      setupBusy: false,
      keyManagerOpen: overrides.keyManagerOpen ?? false,
      drawerOpen: true,
      language,
      t,
      onGoalChange: () => undefined,
      onAccessModeChange: () => undefined,
      onLanguageChange: () => undefined,
      onConfigureSetup: () => undefined,
      onSaveProviderKey: () => undefined,
      onDeleteProviderKey: () => undefined,
      onSaveRoleAssignments: () => undefined,
      onTestSetup: () => undefined,
      onDismissSetup: () => undefined,
      onOpenKeyManager: () => undefined,
      onCloseKeyManager: () => undefined,
      onRun: () => undefined,
      onRefresh: () => undefined,
      onNewTask: () => undefined,
      onSelectSession: () => undefined,
      onApproval: () => undefined,
      onOpenDrawer: () => undefined,
      onCloseDrawer: () => undefined
    })
  );
}

function sampleViewModel(): CockpitViewModel {
  return {
    version: "1",
    sessionId: "session_test",
    goal: "test goal",
    workspace: "tomorrowedge",
    accessMode: "partial",
    sessionMeta: {
      source: "saved",
      sourceLabel: "Saved session",
      connectionState: "idle",
      connectionLabel: "Not connected",
      fixtureMode: true,
      stale: true,
      reconnectAttempts: 0
    },
    status: "waiting_approval",
    statusText: "Waiting approval",
    tasks: [{ id: "session_test", title: "test goal", status: "waiting", updatedAt: "2026-06-07T00:00:00.000Z", reminder: "approval", selected: true }],
    workflow: [
      { id: "plan", label: "Plan", status: "done", summary: "planned" },
      { id: "route", label: "Route", status: "done", summary: "routed" },
      { id: "edit", label: "Edit", status: "done", summary: "edited" },
      { id: "review", label: "Review", status: "done", summary: "reviewed" },
      { id: "test", label: "Test", status: "pending", summary: "waiting" },
      { id: "judge", label: "Judge", status: "done", summary: "judged" },
      { id: "approve", label: "Approve", status: "waiting", summary: "approval" }
    ],
    agents: [],
    routes: [{ role: "planner", provider: "fixture", model: "fixture-scripted", reason: "test" }],
    telemetry: {
      providerSummary: "fixture",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheHitPercent: 0,
      dispatched: 1,
      running: 0,
      completed: 1,
      waiting: 1,
      failed: 0,
      patchWaiting: true,
      shellWaiting: false,
      fallbackCount: 0
    },
    approvals: [],
    approvalHistory: [{
      id: "waiting:patch:fixture_candidate_a",
      approvalId: "patch:fixture_candidate_a",
      kind: "patch",
      status: "waiting",
      action: "waiting",
      actor: "operator",
      source: "browser_cockpit",
      timestamp: "2026-06-07T00:00:00.000Z",
      title: "Waiting for patch approval",
      summary: "Workflow is waiting for patch authorization.",
      blocksProgress: true,
      filterTags: ["patch", "pending"],
      candidateId: "fixture_candidate_a",
      filesChanged: ["index.js"],
      diffRef: "inline:current-approval-diff"
    }],
    capabilities: [{
      id: "provider-routing",
      label: "Provider routing and model availability",
      status: "available",
      category: "provider",
      summary: "Role assignments expose provider/model choices.",
      readiness: "1 provider(s): fixture.",
      refs: ["src/core/routing/policies.ts"]
    }],
    main: { title: "Main", subtitle: "subtitle", body: "body", filesChanged: ["index.js"], testStatus: "not_run" },
    trace: [{ id: "event_1", timestamp: "2026-06-07T00:00:00.000Z", type: "plan", phase: "plan", summary: "planned" }],
    rawEvents: [],
    artifacts: []
  };
}
