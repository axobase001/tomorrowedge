import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../../src/cockpit-web/src/App.js";
import type { CockpitViewModel } from "../../src/cockpit/contracts.js";

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
  });
});

function renderApp(viewModel: CockpitViewModel, overrides: Partial<{ goal: string; statusMessage: string }> = {}): string {
  return renderToStaticMarkup(
    React.createElement(App, {
      viewModel,
      sessions: [{ sessionId: "session_test", createdAt: "2026-06-07T00:00:00.000Z", eventCount: 1, artifactCount: 0, goal: "test" }],
      selectedSession: "session_test",
      goal: overrides.goal ?? "",
      busy: false,
      statusMessage: overrides.statusMessage,
      drawerOpen: true,
      onGoalChange: () => undefined,
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
    main: { title: "Main", subtitle: "subtitle", body: "body", filesChanged: ["index.js"], testStatus: "not_run" },
    trace: [{ id: "event_1", timestamp: "2026-06-07T00:00:00.000Z", type: "plan", phase: "plan", summary: "planned" }],
    rawEvents: [],
    artifacts: []
  };
}
