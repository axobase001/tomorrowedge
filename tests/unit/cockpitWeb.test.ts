import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { App } from "../../src/cockpit-web/src/App.js";
import { canSaveProviderConfig, KeyRoleManager, modelOptionIds, providerFormDefaults, roleModelOptionIds, roleProviderOptions } from "../../src/cockpit-web/src/components/KeyRoleManager.js";
import { ReceiptModal } from "../../src/cockpit-web/src/components/ReceiptModal.js";
import { TaskListPanel } from "../../src/cockpit-web/src/components/TaskListPanel.js";
import { createTranslator, type GuiLanguage } from "../../src/cockpit-web/src/i18n.js";
import { formatProviderConnectionMessage } from "../../src/cockpit-web/src/providerConnectionMessage.js";
import { providerRuntimeErrors } from "../../src/cockpit-web/src/providerRuntimeValidation.js";
import { buildCockpitRunRequest, describeCockpitRunPreview } from "../../src/cockpit-web/src/runRequest.js";
import type { CockpitViewModel } from "../../src/cockpit/contracts.js";
import type { AccessMode } from "../../src/config/schema.js";
import { renderCockpitHtml } from "../../src/localCockpit/html.js";
import { staticModelIdsForProvider } from "../../src/providers/staticModels.js";

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
    expect(html).toContain("Approve patch");
    expect(html).toContain("data-testid=\"approval-reject\"");
    expect(html).toContain("Reject patch");
    expect(html).toContain("data-testid=\"approval-open-drawer\"");
    expect(html).toContain("te-drawer open");
  });

  it("renders shell approval actions with explicit command targets", () => {
    const html = renderApp({
      ...sampleViewModel(),
      currentApproval: {
        id: "shell:npm_test",
        kind: "shell",
        title: "Waiting for shell command approval",
        status: "waiting",
        command: "npm test",
        filesChanged: [],
        riskLevel: "medium",
        testStatus: "not_run",
        summary: "Run verification before applying the patch."
      }
    });

    expect(html).toContain("Approve shell command");
    expect(html).toContain("Reject shell command");
  });

  it("renders explicit empty states for blank cockpit sections", () => {
    const html = renderApp({
      ...sampleViewModel(),
      tasks: [],
      workflow: [],
      routes: [],
      trace: [],
      artifacts: [],
      approvalHistory: [],
      capabilities: [],
      roleGraph: undefined,
      rawEvents: [],
      memoryInfluence: undefined,
      errorLoopTimeline: undefined
    });

    expect(html).toContain("data-testid=\"task-empty-state\"");
    expect(html).toContain("data-testid=\"workflow-empty-state\"");
    expect(html).toContain("data-testid=\"telemetry-routes-empty-state\"");
    expect(html).toContain("data-testid=\"trace-empty-state\"");
    expect(html).toContain("data-testid=\"drawer-memory-empty-state\"");
    expect(html).toContain("data-testid=\"drawer-error-loop-empty-state\"");
    expect(html).toContain("data-testid=\"drawer-approval-empty-state\"");
    expect(html).toContain("data-testid=\"drawer-capabilities-empty-state\"");
    expect(html).toContain("data-testid=\"drawer-routes-empty-state\"");
    expect(html).toContain("data-testid=\"drawer-role-graph-empty-state\"");
    expect(html).toContain("data-testid=\"drawer-artifacts-empty-state\"");
    expect(html).toContain("data-testid=\"drawer-raw-events-empty-state\"");
  });

  it("renders loading affordances while cockpit actions are busy", () => {
    const html = renderApp({
      ...sampleViewModel(),
      currentApproval: {
        id: "patch:fixture_candidate_a",
        kind: "patch",
        title: "Waiting for patch approval",
        status: "waiting",
        candidateId: "fixture_candidate_a",
        filesChanged: ["index.js"],
        summary: "Patch candidate needs approval."
      }
    }, { busy: true, keyManagerOpen: true, setupVisible: true });

    expect(html).toContain("data-testid=\"approval-loading-state\"");
    expect(html).toContain("data-testid=\"keymgr-busy-state\"");
    expect(html).toContain("data-testid=\"setup-loading-state\"");
  });

  it("renders completed sessions as answer-first with workflow detail collapsed", () => {
    const html = renderApp({
      ...sampleViewModel(),
      status: "done",
      statusText: "Done",
      currentApproval: undefined,
      main: {
        title: "Answer",
        subtitle: "completed",
        body: "Hello. I am TomorrowEdge.",
        supportingDetail: "Task: hello\nResult:\n- workflow evidence",
        filesChanged: []
      }
    });

    expect(html).toContain("Hello. I am TomorrowEdge.");
    expect(html).toContain("te-main-answer");
    expect(html).toContain("te-main-support");
    expect(html).toContain("Task: hello");
  });

  it("renders cockpit answers as Markdown with copyable code blocks", () => {
    const html = renderApp({
      ...sampleViewModel(),
      status: "done",
      statusText: "Done",
      currentApproval: undefined,
      main: {
        title: "Answer",
        subtitle: "completed",
        body: [
          "### Summary",
          "",
          "- Use `tedge run`",
          "- Keep trace visible",
          "",
          "```ts",
          "const answer = 42;",
          "```"
        ].join("\n"),
        supportingDetail: "stdout:\n\u001b[31mfailed\u001b[0m",
        filesChanged: []
      }
    });

    expect(html).toContain("data-testid=\"markdown-content\"");
    expect(html).toContain("<h4>");
    expect(html).toContain("Summary");
    expect(html).toContain("<code>tedge run</code>");
    expect(html).toContain("data-testid=\"markdown-code-block\"");
    expect(html).toContain("data-testid=\"markdown-copy-code\"");
    expect(html).toContain("const answer = 42;");
    expect(html).not.toContain("\u001b[31m");
  });

  it("renders main result file deliverables before workflow details", () => {
    const html = renderApp({
      ...sampleViewModel(),
      status: "done",
      statusText: "Done",
      currentApproval: undefined,
      main: {
        title: "Answer",
        subtitle: "completed",
        body: "Done. I prepared the requested script.",
        supportingDetail: "Task: write monkey sort in Python",
        filesChanged: ["monkey_sort.py"],
        deliverables: [{ type: "file", path: "monkey_sort.py" }]
      }
    });

    expect(html).toContain("data-testid=\"main-deliverables\"");
    expect(html).toContain("Deliverables");
    expect(html).toContain("monkey_sort.py");
    expect(html).toContain("Done. I prepared the requested script.");
  });

  it("renders raw code deliverables as copyable code blocks", () => {
    const rawCode = [
      "import random",
      "",
      "def monkey_sort(values):",
      "    items = list(values)",
      "    while items != sorted(items):",
      "        random.shuffle(items)",
      "    return items"
    ].join("\n");
    const html = renderApp({
      ...sampleViewModel(),
      status: "done",
      statusText: "Done",
      currentApproval: undefined,
      main: {
        title: "Answer",
        subtitle: "completed",
        body: rawCode,
        filesChanged: [],
        deliverables: [{ type: "code", language: "python", content: rawCode }]
      }
    });

    expect(html).toContain("data-testid=\"main-deliverables\"");
    expect(html).toContain("data-testid=\"markdown-code-block\"");
    expect(html).toContain("data-testid=\"markdown-copy-code\"");
    expect(html).toContain("def monkey_sort(values):");
  });

  it("renders self-iteration contract, trace, and policy sections in the drawer", () => {
    const html = renderApp(sampleViewModel(), { drawerOpen: true });

    expect(html).toContain("Objective contract");
    expect(html).toContain("Objective trace");
    expect(html).toContain("Orchestration policy");
    expect(html).toContain("contract_test");
    expect(html).toContain("trace_test");
    expect(html).toContain("policy_test");
  });

  it("renders cockpit overlays with modal dialog semantics", () => {
    const html = renderApp(sampleViewModel(), { setupVisible: true, keyManagerOpen: true, drawerOpen: true });
    const receiptHtml = renderToStaticMarkup(
      React.createElement(ReceiptModal, {
        telemetry: localizedZhViewModel().telemetry,
        t: createTranslator("en"),
        onDismiss: () => undefined
      })
    );

    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
    expect(html).toContain("aria-labelledby=\"detail-drawer-title\"");
    expect(html).toContain("aria-labelledby=\"setup-title\"");
    expect(html).toContain("aria-labelledby=\"keymgr-title\"");
    expect(receiptHtml).toContain("aria-labelledby=\"receipt-title\"");
    expect(receiptHtml).toContain("Close cost receipt");
  });

  it("shows composer connection status without clearing the controlled goal", () => {
    const html = renderApp(sampleViewModel(), { goal: "run a smoke task", statusMessage: "Workflow running..." });

    expect(html).toContain("run a smoke task");
    expect(html).toContain("Workflow running...");
    expect(html).toContain("data-testid=\"composer-input\"");
    expect(html).toContain("data-testid=\"composer-mode\"");
    expect(html).toContain("data-testid=\"composer-run-mode\"");
    expect(html).toContain("data-testid=\"composer-target\"");
    expect(html).toContain("data-testid=\"composer-run-preview\"");
    expect(html).toContain("data-testid=\"composer-run-settings\"");
    expect(html).toContain("data-testid=\"composer-test-command\"");
    expect(html).toContain("partial");
  });

  it("requires a visible full-autonomy preflight before full-mode runs", () => {
    const blocked = renderApp(sampleViewModel(), { goal: "fix and verify the project", accessMode: "full" });
    const confirmed = renderApp(sampleViewModel(), { goal: "fix and verify the project", accessMode: "full", fullAutonomyConfirmed: true });

    expect(blocked).toContain("data-testid=\"composer-full-preflight\"");
    expect(blocked).toContain("auto-apply patches");
    expect(blocked).toContain("run shell commands");
    expect(blocked).toContain("execute the repair loop");
    expect(blocked).toContain("write trace artifacts");
    expect(blocked).toContain("data-testid=\"composer-full-preflight-check\"");
    expect(blocked).toMatch(/<button[^>]*disabled=""[^>]*data-testid="composer-submit"|<button[^>]*data-testid="composer-submit"[^>]*disabled=""/);
    expect(confirmed).toContain("Start full task");
    expect(confirmed).not.toMatch(/<button[^>]*data-testid="composer-submit"[^>]*disabled=""/);
  });

  it("exposes stop controls while a cockpit run is busy", () => {
    const html = renderApp(sampleViewModel(), { goal: "long running task", busy: true });

    expect(html).toContain("data-testid=\"topbar-cancel-run\"");
    expect(html).toContain("data-testid=\"composer-cancel-run\"");
    expect(html).toContain("Stop run");
    expect(html).not.toContain("data-testid=\"composer-submit\"");
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

  it("does not synthesize a default workflow for empty GUI goals", () => {
    expect(() => buildCockpitRunRequest({ goal: "   ", accessMode: "partial", setupReady: true })).toThrow("goal_required");
    const html = renderApp(sampleViewModel(), { goal: "" });

    expect(html).toContain("data-testid=\"composer-validation-hint\"");
    expect(html).toContain("disabled=\"\"");
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
    expect(buildCockpitRunRequest({ goal: "rewrite this app in Rust", accessMode: "full", setupReady: false, runMode: "council", target: "core" })).toMatchObject({
      runMode: "council",
      fixtureMode: false,
      livePatch: false,
      liveAdvisory: false,
      repairOnFail: true,
      approveRepair: true,
      to: "core"
    });
  });

  it("passes advanced run settings through GUI request building", () => {
    expect(buildCockpitRunRequest({
      goal: "fix failing test",
      accessMode: "partial",
      setupReady: false,
      runMode: "fixture",
      target: "repairer",
      testCommand: " npm test ",
      repairOnFail: true,
      fixtureFailingPatch: true
    })).toMatchObject({
      runMode: "fixture",
      fixtureMode: true,
      testCommand: "npm test",
      repairOnFail: true,
      approveRepair: false,
      fixtureFailingPatch: true,
      to: "repairer"
    });
  });

  it("previews the effective execution mode before submitting auto runs", () => {
    expect(describeCockpitRunPreview({ accessMode: "partial", setupReady: true, runMode: "auto" })).toMatchObject({
      effectiveMode: "live",
      usesLiveModels: true,
      label: "auto -> live"
    });
    expect(describeCockpitRunPreview({ accessMode: "restricted", setupReady: true, runMode: "auto" })).toMatchObject({
      effectiveMode: "fixture",
      usesLiveModels: false,
      label: "auto -> fixture"
    });
  });

  it("renders the first-run setup wizard with provider and model controls", () => {
    const html = renderApp(sampleViewModel(), { setupVisible: true });

    expect(html).toContain("First-run setup");
    expect(html).toContain("data-testid=\"setup-provider\"");
    expect(html).toContain("list=\"setup-provider-options\"");
    expect(html).toContain("data-testid=\"setup-model\"");
    expect(html).toContain("data-testid=\"setup-base-url\"");
    expect(html).toContain("data-testid=\"setup-request-timeout\"");
    expect(html).toContain("data-testid=\"setup-max-retries\"");
    expect(html).toContain("moonshotai/kimi-k2.6:free");
  });

  it("renders the API key and role manager from the topbar entry", () => {
    const closed = renderApp(sampleViewModel());
    const open = renderApp(sampleViewModel(), { keyManagerOpen: true });

    expect(closed).toContain("data-testid=\"topbar-keys\"");
    expect(open).toContain("API keys and role routing");
    expect(open).toContain("data-testid=\"key-role-manager\"");
    expect(open).toContain("list=\"keymgr-provider-options\"");
    expect(open).toContain("data-testid=\"keymgr-add-relay\"");
    expect(open).toContain("data-testid=\"keymgr-model-select\"");
    expect(open).toContain("data-testid=\"keymgr-base-url\"");
    expect(open).toContain("data-testid=\"keymgr-api-format\"");
    expect(open).toContain("data-testid=\"keymgr-auth-header\"");
    expect(open).toContain("data-testid=\"keymgr-extra-headers\"");
    expect(open).toContain("data-testid=\"keymgr-request-timeout\"");
    expect(open).toContain("data-testid=\"keymgr-max-retries\"");
    expect(open).toContain("data-testid=\"keymgr-save-key\"");
    expect(open).toContain("data-testid=\"keymgr-refresh-models\"");
    expect(open).toContain("qwen/qwen3-coder:free");
    expect(open).toContain("data-testid=\"keymgr-tab-roles\"");
  });

  it("shows one model picker by default in the API key manager", () => {
    const html = renderKeyRoleManager();

    expect(html).toContain("data-testid=\"keymgr-model-select\"");
    expect(html).not.toContain("data-testid=\"keymgr-model\"");
  });

  it("shows the custom model input only for custom API key model values", () => {
    const html = renderKeyRoleManager({ selectedModel: "team/custom-model" });

    expect(html).toContain("data-testid=\"keymgr-model-select\"");
    expect(html).toContain("data-testid=\"keymgr-model\"");
    expect(html).toContain("team/custom-model");
  });

  it("shows one model picker per role unless the role uses a custom model", () => {
    const html = renderKeyRoleManager({ initialTab: "roles" });
    const custom = renderKeyRoleManager({
      initialTab: "roles",
      roleAssignments: [{ role: "planner", provider: "openrouter", model: "team/custom-role-model" }]
    });

    expect(html).toContain("data-testid=\"keymgr-role-model-select-planner\"");
    expect(html).not.toContain("data-testid=\"keymgr-role-model-planner\"");
    expect(custom).toContain("data-testid=\"keymgr-role-model-planner\"");
    expect(custom).toContain("team/custom-role-model");
  });

  it("scopes API key connection warnings to the active key tab and provider", () => {
    const warning = {
      id: "openrouter",
      status: "missing_key" as const,
      reason: "missing_key",
      apiKeyEnv: "OPENROUTER_API_KEY",
      message: "API key is missing."
    };
    const keyTab = renderKeyRoleManager({ connectionResult: warning });
    const roleTab = renderKeyRoleManager({ initialTab: "roles", connectionResult: warning });
    const otherProvider = renderKeyRoleManager({ selectedProvider: "deepseek", connectionResult: warning });

    expect(keyTab).toContain("data-testid=\"keymgr-connection\"");
    expect(roleTab).not.toContain("data-testid=\"keymgr-connection\"");
    expect(otherProvider).not.toContain("data-testid=\"keymgr-connection\"");
  });

  it("keeps provider model drafts isolated by provider defaults", () => {
    const providers = [
      { id: "openrouter", model: "moonshotai/kimi-k2.6:free", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" },
      { id: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY" }
    ];

    expect(providerFormDefaults("openrouter", providers)).toMatchObject({
      model: "moonshotai/kimi-k2.6:free",
      baseUrl: "https://openrouter.ai/api/v1",
      apiFormat: "openai_chat",
      authHeader: "bearer",
      extraHeadersText: "{}",
      requestTimeoutMs: 60000,
      maxRetries: 1
    });
    expect(providerFormDefaults("deepseek", providers)).toMatchObject({
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com"
    });
    expect(providerFormDefaults("team-relay", [])).toMatchObject({
      model: "",
      baseUrl: "",
      apiKeyEnv: "TEAM_RELAY_API_KEY",
      apiFormat: "openai_chat",
      authHeader: "bearer",
      extraHeadersText: "{}"
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
    expect(canSaveProviderConfig({
      provider: "local_relay",
      model: "local-model",
      baseUrl: "http://localhost:9000/v1",
      apiKeyEnv: "",
      apiKey: "",
      keyConfigured: false,
      authHeader: "none",
      busy: false
    })).toBe(true);
    expect(canSaveProviderConfig({
      provider: "local_relay",
      model: "local-model",
      baseUrl: "http://localhost:9000/v1",
      apiKeyEnv: "",
      apiKey: "",
      keyConfigured: false,
      authHeader: "none",
      extraHeadersValid: false,
      busy: false
    })).toBe(false);
  });

  it("blocks provider runtime saves with invalid timeout and retry drafts", () => {
    expect(providerRuntimeErrors({ requestTimeoutMs: "-1", maxRetries: "-2" })).toEqual({
      requestTimeoutMs: "positive_integer",
      maxRetries: "non_negative_integer"
    });
    expect(providerRuntimeErrors({ requestTimeoutMs: "60000", maxRetries: "0" })).toEqual({});
    expect(canSaveProviderConfig({
      provider: "openrouter",
      model: "qwen/qwen3-coder:free",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      apiKey: "",
      keyConfigured: true,
      busy: false,
      requestTimeoutMs: "-1",
      maxRetries: "1"
    })).toBe(false);
    expect(canSaveProviderConfig({
      provider: "openrouter",
      model: "qwen/qwen3-coder:free",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      apiKey: "",
      keyConfigured: true,
      busy: false,
      requestTimeoutMs: "60000",
      maxRetries: "1"
    })).toBe(true);
  });

  it("combines static and catalog model recommendations for the picker", () => {
    expect(modelOptionIds("openrouter", "moonshotai/kimi-k2.6:free", [{ id: "qwen/qwen3-coder:free", label: "Qwen", source: "catalog" }])).toContain("qwen/qwen3-coder:free");
  });

  it("keeps OpenAI-compatible fallback model options provider-safe", () => {
    const options = modelOptionIds("openai_compatible", undefined, []);

    expect(options).toContain("gpt-4o-mini");
    expect(options).toContain("gpt-4.1-mini");
    expect(options).not.toContain("qwen/qwen3-coder:free");
    expect(options).toEqual(expect.arrayContaining(staticModelIdsForProvider("openai_compatible")));
  });

  it("exposes provider models to role-level model pickers", () => {
    expect(roleModelOptionIds("openrouter", [{
      id: "openrouter",
      model: "moonshotai/kimi-k2.6:free",
      models: [
        { id: "moonshotai/kimi-k2.6:free", label: "Kimi", source: "config" },
        { id: "qwen/qwen3-coder:free", label: "Qwen", source: "config" }
      ]
    }], "qwen/qwen3-coder:free")).toContain("qwen/qwen3-coder:free");
  });

  it("exposes refreshed provider catalog models to matching role pickers only", () => {
    const providers = [{
      id: "openrouter",
      model: "moonshotai/kimi-k2.6:free",
      models: [{ id: "moonshotai/kimi-k2.6:free", label: "Kimi", source: "config" as const }]
    }, {
      id: "deepseek",
      model: "deepseek-chat",
      models: [{ id: "deepseek-chat", label: "DeepSeek Chat", source: "config" as const }]
    }];
    const catalog = {
      openrouter: [{ id: "openai/gpt-5.2", label: "GPT 5.2", source: "catalog" as const }]
    };

    expect(roleModelOptionIds("openrouter", providers, "moonshotai/kimi-k2.6:free", catalog)).toContain("openai/gpt-5.2");
    expect(roleModelOptionIds("deepseek", providers, "deepseek-chat", catalog)).not.toContain("openai/gpt-5.2");
  });

  it("renders the role assignment tab entry in the key manager", () => {
    const html = renderApp(sampleViewModel(), { keyManagerOpen: true });

    expect(html).toContain("data-testid=\"keymgr-tab-roles\"");
    expect(html).toContain("Role Assign");
    expect(html).toContain("role=\"tablist\"");
    expect(html).toContain("role=\"tab\"");
    expect(html).toContain("aria-selected=\"true\"");
    expect(html).toContain("aria-controls=\"keymgr-panel-keys\"");
    expect(html).toContain("role=\"tabpanel\"");
    expect(html).toContain("aria-labelledby=\"keymgr-tab-keys\"");
    expect(html).toContain("tabindex=\"-1\"");
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

  it("keeps no-auth local providers available for GUI role assignment", () => {
    expect(roleProviderOptions(["openrouter", "ollama", "fixture"], [], "ollama")).toContain("ollama");
    expect(roleProviderOptions(["openrouter"], [], "ollama")).toContain("ollama");
  });

  it("renders telemetry details as an accessible drawer button", () => {
    const html = renderApp(sampleViewModel());

    expect(html).toContain("data-testid=\"telemetry-details\"");
    expect(html).toContain("<button");
    expect(html).not.toContain("<a>details &gt;</a>");
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
    expect(html).toContain("New task");
    expect(html).toContain("Telemetry");
  });

  it("renders the GUI chrome in Chinese when selected", () => {
    const html = renderApp(sampleViewModel(), { language: "zh", setupVisible: true, keyManagerOpen: true });

    expect(html).toContain("语言");
    expect(html).toContain("任务");
    expect(html).toContain("新任务");
    expect(html).toContain("密钥与角色管理");
    expect(html).toContain("至少连接一个模型");
  });

  it("localizes React cockpit telemetry, council, drawer, key-manager, and markdown chrome in Chinese", () => {
    const html = renderApp(localizedZhViewModel(), { language: "zh", keyManagerOpen: true });

    expect(html).toContain("降级 1");
    expect(html).toContain("剩余 $0.8800");
    expect(html).toContain("实时成本");
    expect(html).toContain("强模型调用");
    expect(html).toContain("真实 2 / 模拟 5");
    expect(html).toContain("成本明细");
    expect(html).toContain("规划");
    expect(html).toContain("路由");
    expect(html).toContain("编辑");
    expect(html).toContain("审查");
    expect(html).toContain("审批");
    expect(html).toContain("主控");
    expect(html).toContain("评议会");
    expect(html).toContain("1 个成员");
    expect(html).toContain("归属");
    expect(html).toContain("1 个任务");
    expect(html).toContain("策略变更");
    expect(html).toContain("最终审查");
    expect(html).toContain("Agent Council 治理");
    expect(html).toContain("任务图");
    expect(html).toContain("服务商");
    expect(html).toContain("基础地址");
    expect(html).toContain("API 密钥环境变量");
    expect(html).toContain("保存服务商");
    expect(html).toContain("自定义模型...");
    expect(html).toContain("复制");
    expect(html).not.toContain("live cost");
    expect(html).not.toContain("strong calls");
    expect(html).not.toContain(">receipt<");
    expect(html).not.toContain("Open cost receipt");
    expect(html).not.toContain("Custom model...");
    expect(html).not.toContain("TaskGraph");
    expect(html).not.toContain(">Provider<");
    expect(html).not.toContain(">Base URL<");
    expect(html).not.toContain("保存 provider");
    expect(html).not.toContain("Copy</button>");
  });

  it("localizes the cost receipt modal in Chinese", () => {
    const viewModel = localizedZhViewModel();
    const html = renderToStaticMarkup(
      React.createElement(ReceiptModal, {
        telemetry: viewModel.telemetry,
        t: createTranslator("zh"),
        onDismiss: () => undefined
      })
    );
    const emptyHtml = renderToStaticMarkup(
      React.createElement(ReceiptModal, {
        telemetry: { ...viewModel.telemetry, roleCosts: [] },
        t: createTranslator("zh"),
        onDismiss: () => undefined
      })
    );

    expect(html).toContain("成本明细");
    expect(html).toContain("TomorrowEdge 工作流");
    expect(html).toContain("实际");
    expect(html).toContain("预算");
    expect(html).toContain("剩余");
    expect(html).toContain("已用");
    expect(html).toContain("角色");
    expect(html).toContain("模型");
    expect(html).toContain("成本");
    expect(html).toContain("关闭");
    expect(emptyHtml).toContain("这个会话还没有可计量的角色成本。");
    expect(html).not.toContain("Cost receipt");
    expect(html).not.toContain("TomorrowEdge workflow");
    expect(emptyHtml).not.toContain("No measured role costs for this session.");
  });

  it("formats provider connection guidance in Chinese for missing keys", () => {
    const message = formatProviderConnectionMessage({
      id: "openrouter",
      status: "missing_key",
      reason: "missing_key",
      apiKeyEnv: "OPENROUTER_API_KEY",
      detail: "missing env OPENROUTER_API_KEY"
    }, createTranslator("zh"));

    expect(message).toContain("缺少 API key");
    expect(message).toContain("OPENROUTER_API_KEY");
  });

  it("formats provider connection guidance in English for invalid models", () => {
    const message = formatProviderConnectionMessage({
      id: "openai_compatible",
      status: "failed",
      reason: "invalid_model",
      testedModel: "bad-model-id",
      detail: "{\"error\":{\"message\":\"invalid model ID\"}}"
    }, createTranslator("en"));

    expect(message).toContain("Model ID was rejected by the provider");
    expect(message).toContain("bad-model-id");
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
    expect(html).toContain("#n_abc123");
  });

  it("adds stable session discriminators for repeated benchmark-like sessions", () => {
    const html = renderToStaticMarkup(
      React.createElement(TaskListPanel, {
        tasks: [],
        sessions: [
          { sessionId: "session_benchmark_alpha1111", createdAt: "2026-06-07T00:00:00.000Z", eventCount: 1, artifactCount: 0, goal: "Terminal-Bench write-compressor", result: "completed", discriminator: "alpha1111", runLabel: "bench:kimi" },
          { sessionId: "session_benchmark_beta2222", createdAt: "2026-06-07T00:01:00.000Z", eventCount: 1, artifactCount: 0, goal: "Terminal-Bench write-compressor", result: "completed", discriminator: "beta2222", runLabel: "bench:glm" }
        ],
        selectedSession: "session_benchmark_beta2222",
        t: createTranslator("en"),
        onSelectSession: () => undefined,
        onNewTask: () => undefined,
        onRenameSession: () => undefined,
        onDeleteSession: () => undefined
      })
    );

    expect(html).toContain("bench:kimi #alpha1111");
    expect(html).toContain("bench:glm #beta2222");
  });

  it("renders saved sessions as visible history with result and metadata", () => {
    const html = renderToStaticMarkup(
      React.createElement(TaskListPanel, {
        tasks: [],
        sessions: [
          { sessionId: "session_first", createdAt: "2026-06-07T00:00:00.000Z", eventCount: 2, artifactCount: 1, goal: "first small prompt", result: "completed" },
          { sessionId: "session_second", createdAt: "2026-06-07T00:05:00.000Z", eventCount: 3, artifactCount: 2, goal: "second real request", result: "failed" }
        ],
        selectedSession: "session_second",
        t: createTranslator("en"),
        onSelectSession: () => undefined,
        onNewTask: () => undefined,
        onRenameSession: () => undefined,
        onDeleteSession: () => undefined
      })
    );

    expect(html).toContain("data-testid=\"session-history\"");
    expect(html).toContain("Recent runs");
    expect(html).toContain("Current tasks");
    expect(html).toContain("2 saved");
    expect(html).toContain("0 current");
    expect((html.match(/data-testid="session-history-item"/g) ?? []).length).toBe(2);
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(1);
    expect(html).toContain("tabindex=\"0\"");
    expect(html).toContain("first small prompt");
    expect(html).toContain("second real request");
    expect(html).toContain("completed");
    expect(html).toContain("failed");
    expect(html).toContain("2026-06-07 00:00");
    expect(html).toContain("2 events / 1 artifacts");
    expect(html).toContain("aria-current=\"true\"");
  });

  it("renders status chips with visible non-color signals", () => {
    const html = renderApp(sampleViewModel());

    expect(html).toContain("te-status-chip");
    expect(html).toContain("te-chip-signal");
    expect(html).toContain(">WAIT</span>");
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
        outcomePredictions: 1,
        outcomeMismatches: 1,
        failedVerifications: 1,
        passedVerifications: 1,
        policyDecisions: 1,
        repairAttempts: 1,
        memoryRetrievals: 1,
        stopReason: "repair applied and verification passed",
        items: [{
          id: "shell_prediction",
          timestamp: "2026-06-07T00:00:00.000Z",
          kind: "prediction",
          status: "proposed",
          title: "Outcome prediction",
          summary: "shell predicts passed",
          command: "npm test",
          filesChanged: [],
          artifactRefs: ["artifacts/predictions/shell.json"],
          memoryIds: []
        }, {
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
          id: "shell_observation",
          timestamp: "2026-06-07T00:00:00.250Z",
          kind: "observation",
          status: "mismatch",
          title: "Outcome observation",
          summary: "failed mismatch=wrong_assumption",
          command: "npm test",
          filesChanged: [],
          artifactRefs: ["artifacts/observations/shell.json"],
          memoryIds: []
        }, {
          id: "repair_policy",
          timestamp: "2026-06-07T00:00:00.500Z",
          kind: "policy",
          status: "allowed",
          title: "Repair policy decision",
          summary: "semantic_test_failure occurrence=1 action=repair",
          filesChanged: [],
          artifactRefs: [],
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
    const designSystem = readFileSync(path.join(process.cwd(), "docs", "GUI_DESIGN_SYSTEM.md"), "utf8");
    const styleDoc = readFileSync(path.join(process.cwd(), "docs", "UI_STYLE.md"), "utf8");
    const deviationDoc = readFileSync(path.join(process.cwd(), "docs", "ui", "gui-v1.1", "implementation_deviation.md"), "utf8");
    const tinyLmCss = readFileSync(path.join(process.cwd(), "examples", "tiny-local-lm", "public", "styles.css"), "utf8");
    const sampleCss = readFileSync(path.join(process.cwd(), "tests", "fixtures", "sample-repo-react-ui", "src", "style.css"), "utf8");
    const siteCss = readFileSync(path.join(process.cwd(), "docs", "site", "tomorrowedge.css"), "utf8");

    expect(tokens).toContain("prefers-color-scheme: dark");
    expect(tokens).toContain("button:focus-visible");
    expect(tokens).toContain("prefers-reduced-motion: reduce");
    expect(tokens).toContain(".te-field-error");
    expect(tokens).toContain("--te-mark-red");
    expect(tokens).toContain(".te-empty-state");
    expect(tinyLmCss).toContain("--lm-bg");
    expect(tinyLmCss).toContain("button:focus-visible");
    expect(sampleCss).toContain("--sample-bg");
    expect(sampleCss).toContain("button:focus-visible");
    expect(siteCss).toContain("--focus-ring");
    expect(siteCss).toContain("button:focus-visible");
    expect(fallback).toContain("prefers-color-scheme: dark");
    expect(fallback).toContain('<html lang="en">');
    expect(fallback).toContain("id=\"drawer-backdrop\"");
    expect(fallback).toContain("role=\"dialog\"");
    expect(fallback).toContain("trapDrawerFocus");
    expect(fallback).toContain("id=\"stop-run\"");
    expect(fallback).toContain("id=\"full-preflight\"");
    expect(fallback).toContain("/cancel");
    expect(fallback).not.toContain("min-width: 1080px");
    expect(fallback).not.toContain("min-width: 980px");
    expect(styleDoc).toContain("docs/GUI_DESIGN_SYSTEM.md");
    expect(styleDoc).toContain("Default browser GUI language: English");
    expect(deviationDoc).toContain("fallback remains English-only");
    for (const token of ["--te-bg", "--te-surface", "--te-border", "--te-text", "--te-warning", "--te-danger"]) {
      expect(tokens).toContain(token);
      expect(designSystem).toContain(token);
    }
    for (const fallbackToken of ["--bg", "--surface", "--border", "--text", "--warning", "--danger"]) {
      expect(fallback).toContain(fallbackToken);
      expect(designSystem).toContain(fallbackToken);
    }
    for (const requiredState of ["focus-visible", "disabled", "loading", "waiting-approval", "running", "disconnected"]) {
      expect(designSystem).toContain(requiredState);
    }
  });
});

type KeyRoleManagerComponentProps = React.ComponentProps<typeof KeyRoleManager>;

function renderKeyRoleManager(overrides: Partial<{
  initialTab: "keys" | "roles";
  selectedProvider: string;
  selectedModel: string;
  roleAssignments: NonNullable<KeyRoleManagerComponentProps["setupStatus"]>["roleAssignments"];
  connectionResult: KeyRoleManagerComponentProps["connectionResult"];
}> = {}): string {
  const t = createTranslator("en");
  return renderToStaticMarkup(
    React.createElement(KeyRoleManager, {
      setupStatus: {
        needsSetup: true,
        recommendedProvider: "openrouter",
        configPath: ".tomorrowedge/config.yaml",
        providers: [{
          id: "openrouter",
          enabled: false,
          model: "moonshotai/kimi-k2.6:free",
          models: [{ id: "moonshotai/kimi-k2.6:free", label: "Kimi", source: "config" }],
          baseUrl: "https://openrouter.ai/api/v1",
          apiKeyEnv: "OPENROUTER_API_KEY",
          keyConfigured: false,
          keySource: "missing",
          authRequired: true,
          apiFormat: "openai_chat",
          authHeader: "bearer",
          extraHeaders: {},
          requestTimeoutMs: 60000,
          maxRetries: 1
        }, {
          id: "deepseek",
          enabled: false,
          model: "deepseek-chat",
          models: [{ id: "deepseek-chat", label: "DeepSeek Chat", source: "config" }],
          baseUrl: "https://api.deepseek.com/v1",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          keyConfigured: false,
          keySource: "missing",
          authRequired: true,
          apiFormat: "openai_chat",
          authHeader: "bearer",
          extraHeaders: {},
          requestTimeoutMs: 60000,
          maxRetries: 1
        }],
        externalAgents: [],
        roleAssignments: overrides.roleAssignments ?? [
          { role: "planner", provider: "openrouter", model: "moonshotai/kimi-k2.6:free" },
          { role: "reviewer", provider: "deepseek", model: "deepseek-chat" }
        ],
        selectedProvider: overrides.selectedProvider ?? "openrouter",
        selectedModel: overrides.selectedModel
      },
      busy: false,
      message: undefined,
      connectionResult: overrides.connectionResult,
      t,
      onClose: () => undefined,
      onSaveProviderKey: () => undefined,
      onDeleteProviderKey: () => undefined,
      onSaveRoleAssignments: () => undefined,
      onTestProvider: () => undefined,
      onListProviderModels: async () => [],
      initialTab: overrides.initialTab
    })
  );
}

function renderApp(viewModel: CockpitViewModel, overrides: Partial<{ goal: string; statusMessage: string; setupVisible: boolean; keyManagerOpen: boolean; language: GuiLanguage; busy: boolean; drawerOpen: boolean; accessMode: AccessMode; fullAutonomyConfirmed: boolean }> = {}): string {
  const language = overrides.language ?? "en";
  const t = createTranslator(language);
  const accessMode = overrides.accessMode ?? "partial";
  return renderToStaticMarkup(
    React.createElement(App, {
      viewModel,
      sessions: [{ sessionId: "session_test", createdAt: "2026-06-07T00:00:00.000Z", eventCount: 1, artifactCount: 0, goal: "test" }],
      selectedSession: "session_test",
      goal: overrides.goal ?? "",
      accessMode,
      runMode: "auto",
      runPreview: "auto -> fixture · sample fixture workspace",
      conversationTarget: "core",
      testCommand: "",
      repairOnFail: false,
      fixtureFailingPatch: false,
      fullAutonomyConfirmed: overrides.fullAutonomyConfirmed ?? false,
      busy: overrides.busy ?? false,
      statusMessage: overrides.statusMessage,
      setupStatus: {
        needsSetup: true,
        recommendedProvider: "openrouter",
        configPath: ".tomorrowedge/config.yaml",
        providers: [{
          id: "openrouter",
          enabled: false,
          model: "",
          models: [{ id: "moonshotai/kimi-k2.6:free", label: "Kimi", source: "config" }],
          baseUrl: "https://openrouter.ai/api/v1",
          apiKeyEnv: "OPENROUTER_API_KEY",
          keyConfigured: false,
          keySource: "missing",
          authRequired: true,
          apiFormat: "openai_chat",
          authHeader: "bearer",
          extraHeaders: {},
          requestTimeoutMs: 60000,
          maxRetries: 1
        }, {
          id: "deepseek",
          enabled: false,
          model: "deepseek-chat",
          models: [{ id: "deepseek-chat", label: "DeepSeek Chat", source: "config" }],
          baseUrl: "https://api.deepseek.com/v1",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          keyConfigured: false,
          keySource: "missing",
          authRequired: true,
          apiFormat: "openai_chat",
          authHeader: "bearer",
          extraHeaders: {},
          requestTimeoutMs: 60000,
          maxRetries: 1
        }],
        externalAgents: [],
        roleAssignments: [
          { role: "planner", provider: "openrouter", model: "moonshotai/kimi-k2.6:free" },
          { role: "reviewer", provider: "deepseek", model: "deepseek-chat" }
        ]
      },
      setupVisible: overrides.setupVisible ?? false,
      setupBusy: overrides.busy ?? false,
      keyManagerOpen: overrides.keyManagerOpen ?? false,
      drawerOpen: overrides.drawerOpen ?? true,
      language,
      t,
      onGoalChange: () => undefined,
      onAccessModeChange: () => undefined,
      onRunModeChange: () => undefined,
      onTestCommandChange: () => undefined,
      onRepairOnFailChange: () => undefined,
      onFixtureFailingPatchChange: () => undefined,
      onFullAutonomyConfirmedChange: () => undefined,
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
      onCancelRun: () => undefined,
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
    objectiveContract: {
      contractId: "contract_test",
      scenarioType: "debugging",
      workflowKind: "patch",
      localObjective: "Fix the failing test with evidence.",
      successCriteria: ["Test passes"],
      failureCriteria: ["Verification fails"],
      requiredEvidence: ["objective contract", "review decision"],
      allowedTools: ["file_read", "patch_apply"],
      forbiddenActions: ["bypass_event_ledger"],
      riskLevel: "low",
      source: "native",
      verificationStatus: "passed",
      verificationScore: 98,
      stopCondition: {
        success: ["criteria met"],
        partial: ["approval pending"],
        failure: ["verification failed"],
        unsafe: ["forbidden action"]
      }
    },
    objectiveTrace: {
      similarTraceIds: [],
      lessonsReused: ["reuse contract-first patch flow"],
      failurePatternsAvoided: [],
      traceWritten: true,
      traceId: "trace_test",
      evidenceScore: 83,
      outcomeStatus: "partial",
      missingEvidence: ["verification result"]
    },
    orchestrationPolicy: {
      policyId: "policy_test",
      mode: "trace_guided",
      contractDepth: "medium",
      traceTopK: 3,
      verificationStrictness: "medium",
      repairRounds: 2,
      stopMode: "balanced",
      fitness: 274
    },
    main: { title: "Main", subtitle: "subtitle", body: "body", filesChanged: ["index.js"], testStatus: "not_run" },
    trace: [{ id: "event_1", timestamp: "2026-06-07T00:00:00.000Z", type: "plan", phase: "plan", summary: "planned" }],
    rawEvents: [],
    artifacts: []
  };
}

function localizedZhViewModel(): CockpitViewModel {
  const base = sampleViewModel();
  return {
    ...base,
    status: "running",
    statusText: "Running",
    telemetry: {
      ...base.telemetry,
      currentCostUsd: 0.12,
      budgetUsd: 1,
      budgetRemainingUsd: 0.88,
      budgetUsedPercent: 12,
      liveRunningCostUsd: 0.03,
      realStrongAgentCallsUsed: 2,
      simulatedStrongAgentCallsUsed: 5,
      fallbackCount: 1,
      roleCosts: [{ role: "planner", model: "fixture-scripted", costUsd: 0.01, percent: 8 }]
    },
    chiefAgent: {
      chiefAgentId: "chief_1",
      provider: "fixture",
      model: "fixture-chief",
      decision: "approve",
      trustLevel: "high"
    },
    council: {
      sessionId: "session_test",
      status: "running",
      members: [{ agentId: "agent_1", provider: "fixture", model: "fixture-agent", role: "reviewer" }],
      moves: [],
      unresolvedRisks: []
    },
    taskOwnership: {
      assignments: [{
        taskNodeId: "task_1",
        title: "review patch",
        ownerAgentId: "agent_1",
        provider: "fixture",
        model: "fixture-agent",
        reason: "coverage",
        fallbackAgents: []
      }]
    },
    policyMutations: {
      count: 1,
      mutations: []
    },
    finalReview: {
      chiefAgentId: "chief_1",
      decision: "approved",
      architectureConsistency: "ok",
      codeReviewSummary: "reviewed",
      taskCompletionSummary: "complete",
      unresolvedRisks: [],
      requiredRevisions: [],
      evidenceRefs: [],
      artifactRefs: []
    },
    main: {
      title: "Main",
      subtitle: "subtitle",
      body: ["```ts", "const answer = 42;", "```"].join("\n"),
      filesChanged: []
    }
  };
}
