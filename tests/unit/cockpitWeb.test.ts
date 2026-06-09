import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { App } from "../../src/cockpit-web/src/App.js";
import { canSaveProviderConfig, modelOptionIds, providerFormDefaults, roleProviderOptions } from "../../src/cockpit-web/src/components/KeyRoleManager.js";
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
    expect(html).toContain("data-testid=\"composer-input\"");
    expect(html).toContain("data-testid=\"composer-mode\"");
    expect(html).toContain("data-testid=\"composer-run-mode\"");
    expect(html).toContain("data-testid=\"composer-target\"");
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

  it("lets GUI runs explicitly choose target role and run mode", () => {
    expect(buildCockpitRunRequest({ goal: "review patch", accessMode: "partial", setupReady: true, runMode: "offline", target: "reviewer" })).toMatchObject({
      runMode: "offline",
      fixtureMode: false,
      livePatch: false,
      liveAdvisory: false,
      to: "reviewer"
    });
    expect(buildCockpitRunRequest({ goal: "debate this", accessMode: "partial", setupReady: true, runMode: "fixture", target: "debate" })).toMatchObject({
      runMode: "fixture",
      fixtureMode: true,
      livePatch: false,
      liveAdvisory: false,
      to: "debate"
    });
    expect(buildCockpitRunRequest({ goal: "run live", accessMode: "partial", setupReady: false, runMode: "live", target: "planner" })).toMatchObject({
      runMode: "live",
      fixtureMode: false,
      livePatch: true,
      liveAdvisory: true,
      to: "planner"
    });
  });

  it("renders the first-run setup wizard with provider and model controls", () => {
    const html = renderApp(sampleViewModel(), { setupVisible: true });

    expect(html).toContain("First-run setup");
    expect(html).toContain("data-testid=\"setup-provider\"");
    expect(html).toContain("list=\"setup-provider-options\"");
    expect(html).toContain("data-testid=\"setup-model\"");
    expect(html).toContain("data-testid=\"setup-base-url\"");
    expect(html).toContain("moonshotai/kimi-k2.6:free");
  });

  it("renders the API key and role manager from the topbar entry", () => {
    const closed = renderApp(sampleViewModel());
    const open = renderApp(sampleViewModel(), { keyManagerOpen: true });

    expect(closed).toContain("data-testid=\"topbar-keys\"");
    expect(open).toContain("API keys and role routing");
    expect(open).toContain("data-testid=\"key-role-manager\"");
    expect(open).toContain("list=\"keymgr-provider-options\"");
    expect(open).toContain("data-testid=\"keymgr-base-url\"");
    expect(open).toContain("data-testid=\"keymgr-save-key\"");
    expect(open).toContain("data-testid=\"keymgr-refresh-models\"");
    expect(open).toContain("qwen/qwen3-coder:free");
    expect(open).toContain("data-testid=\"keymgr-tab-roles\"");
  });

  it("keeps provider model drafts isolated by provider defaults", () => {
    const providers = [
      { id: "openrouter", model: "moonshotai/kimi-k2.6:free", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" },
      { id: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY" }
    ];

    expect(providerFormDefaults("openrouter", providers)).toMatchObject({
      model: "moonshotai/kimi-k2.6:free",
      baseUrl: "https://openrouter.ai/api/v1"
    });
    expect(providerFormDefaults("deepseek", providers)).toMatchObject({
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com"
    });
  });

  it("allows model-only provider saves after a key is already configured", () => {
    expect(canSaveProviderConfig({
      provider: "openrouter",
      model: "qwen/qwen3-coder:free",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      apiKey: "",
      keyConfigured: true,
      busy: false
    })).toBe(true);
    expect(canSaveProviderConfig({
      provider: "openrouter",
      model: "qwen/qwen3-coder:free",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      apiKey: "",
      keyConfigured: false,
      busy: false
    })).toBe(false);
  });

  it("combines static and catalog model recommendations for the picker", () => {
    expect(modelOptionIds("openrouter", "moonshotai/kimi-k2.6:free", [{ id: "qwen/qwen3-coder:free", label: "Qwen", source: "catalog" }])).toContain("qwen/qwen3-coder:free");
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
        onNewTask: () => undefined,
        onRenameSession: () => undefined,
        onDeleteSession: () => undefined
      })
    );

    expect(html).toContain('<option value="session_new" selected="">session_new</option>');
    expect(html).not.toContain('<option value="latest"');
  });

  it("labels saved sessions by task goal instead of opaque ids", () => {
    const html = renderToStaticMarkup(
      React.createElement(TaskListPanel, {
        tasks: [],
        sessions: [{ sessionId: "session_abc123", createdAt: "2026-06-07T00:00:00.000Z", eventCount: 1, artifactCount: 0, goal: "read the quantum folder and summarize structure", result: "completed" }],
        selectedSession: "session_abc123",
        t: createTranslator("en"),
        onSelectSession: () => undefined,
        onNewTask: () => undefined,
        onRenameSession: () => undefined,
        onDeleteSession: () => undefined
      })
    );

    expect(html).toContain("read the quantum folder and summarize structure");
    expect(html).toContain("completed");
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

  it("renders clickable artifact links in the detail drawer", () => {
    const html = renderApp({
      ...sampleViewModel(),
      artifacts: [{ ref: "artifacts/stdout/test.txt", kind: "stdout" }]
    });

    expect(html).toContain("data-testid=\"drawer-artifacts\"");
    expect(html).toContain("href=\"/api/sessions/session_test/artifacts/artifacts%2Fstdout%2Ftest.txt\"");
  });

  it("renders the workflow role graph in the detail drawer", () => {
    const html = renderApp(sampleViewModel());

    expect(html).toContain("Role graph");
    expect(html).toContain("workflow=patch");
    expect(html).toContain("planner (planner) required");
    expect(html).toContain("stop=judge_abort");
  });

  it("renders capability dashboard readiness in the detail drawer", () => {
    const html = renderApp(sampleViewModel());

    expect(html).toContain("Capability dashboard");
    expect(html).toContain("Provider routing and model availability");
    expect(html).toContain("[available]");
  });

  it("renders retrieved memory influence cards in the detail drawer", () => {
    const html = renderApp({
      ...sampleViewModel(),
      memoryInfluence: {
        selectedCount: 1,
        rejectedCount: 1,
        negativeTransferCandidates: 0,
        cards: [{
          id: "memory-premortem",
          stage: "premortem",
          status: "accepted",
          injectedRole: "planner",
          memoryIds: ["mem_validation"],
          score: 8,
          matchedFeatures: ["validation_failed:test_command"],
          decisionImpact: "Added 1 planner constraint/check item(s).",
          artifactRef: "artifacts/memory/memory_1.json",
          constraints: ["Run npm test before approving."],
          violations: [],
          alignment: ["npm test"]
        }]
      }
    });

    expect(html).toContain("Memory influence");
    expect(html).toContain("premortem");
    expect(html).toContain("mem_validation");
    expect(html).toContain("Added 1 planner constraint/check item(s).");
    expect(html).toContain("href=\"/api/sessions/session_test/artifacts/artifacts%2Fmemory%2Fmemory_1.json\"");
  });

  it("renders error-loop timeline cards in the detail drawer", () => {
    const html = renderApp({
      ...sampleViewModel(),
      errorLoopTimeline: {
        candidateAttempts: 1,
        failedVerifications: 1,
        passedVerifications: 1,
        repairAttempts: 1,
        memoryRetrievals: 1,
        stopReason: "repair applied and verification passed",
        items: [{
          id: "shell_failed",
          timestamp: "2026-06-07T00:00:00.000Z",
          kind: "verification",
          status: "failed",
          title: "Verification failed",
          summary: "exit=1",
          command: "npm test",
          filesChanged: [],
          artifactRefs: ["artifacts/stderr/failed.txt"],
          exitCode: 1,
          durationMs: 22,
          memoryIds: []
        }, {
          id: "repair_memory",
          timestamp: "2026-06-07T00:00:01.000Z",
          kind: "memory",
          status: "used",
          title: "Failure memory repair_context",
          summary: "repair context selected 1 memory",
          filesChanged: [],
          artifactRefs: ["artifacts/memory/repair_context.json"],
          memoryIds: ["mem_validation"]
        }]
      }
    });

    expect(html).toContain("Error-loop timeline");
    expect(html).toContain("data-testid=\"drawer-error-loop-timeline\"");
    expect(html).toContain("Verification failed");
    expect(html).toContain("mem_validation");
    expect(html).toContain("artifacts/memory/repair_context.json");
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
      runMode: "auto",
      conversationTarget: "core",
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
          { role: "planner", provider: "openrouter", model: "moonshotai/kimi-k2.6:free" },
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
      onRunModeChange: () => undefined,
      onConversationTargetChange: () => undefined,
      onLanguageChange: () => undefined,
      onConfigureSetup: () => undefined,
      onSaveProviderKey: () => undefined,
      onDeleteProviderKey: () => undefined,
      onSaveRoleAssignments: () => undefined,
      onTestSetup: () => undefined,
      onListProviderModels: async () => [],
      onDismissSetup: () => undefined,
      onOpenKeyManager: () => undefined,
      onCloseKeyManager: () => undefined,
      onRun: () => undefined,
      onRefresh: () => undefined,
      onNewTask: () => undefined,
      onSelectSession: () => undefined,
      onRenameSession: () => undefined,
      onDeleteSession: () => undefined,
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
    roleGraph: {
      workflowKind: "patch",
      nodes: [{
        id: "planner",
        role: "planner",
        required: true,
        dependencies: [],
        canFallback: true,
        canSkip: false,
        maxRetries: 0,
        produces: ["plan"],
        consumes: []
      }],
      stopConditions: ["judge_abort"]
    },
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
