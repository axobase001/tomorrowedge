import { describe, expect, it } from "vitest";
import { CockpitEventBus } from "../../src/cockpit/eventBus.js";
import type { AgentGraphState } from "../../src/core/agentGraph/state.js";

describe("cockpit event bus", () => {
  it("bounds retained snapshots and evicts the oldest sessions", () => {
    let now = 0;
    const bus = new CockpitEventBus({ maxSnapshots: 2, now: () => now });

    bus.setSnapshot(snapshot("run_1", false));
    now += 1;
    bus.setSnapshot(snapshot("run_2", false));
    now += 1;
    bus.setSnapshot(snapshot("run_3", false));

    expect(bus.getSnapshot("run_1")).toBeUndefined();
    expect(bus.getSnapshot("run_2")?.sessionId).toBe("run_2");
    expect(bus.getSnapshot("run_3")?.sessionId).toBe("run_3");
  });

  it("expires terminal snapshots and stale cancellation markers", () => {
    let now = 100;
    const bus = new CockpitEventBus({
      terminalSnapshotTtlMs: 10,
      canceledSessionTtlMs: 10,
      now: () => now
    });

    bus.setSnapshot(snapshot("run_done", true));
    bus.cancelSession("run_cancel");
    expect(bus.getSnapshot("run_done")).toBeTruthy();
    expect(bus.isCanceled("run_cancel")).toBe(true);

    now = 111;
    expect(bus.getSnapshot("run_done")).toBeUndefined();
    expect(bus.isCanceled("run_cancel")).toBe(false);
  });

  it("keeps cancellation markers after terminal snapshots until they expire", () => {
    let now = 200;
    const bus = new CockpitEventBus({ canceledSessionTtlMs: 10, now: () => now });

    bus.cancelSession("run_done");
    bus.setSnapshot(snapshot("run_done", true));

    expect(bus.isCanceled("run_done")).toBe(true);
    now = 211;
    expect(bus.isCanceled("run_done")).toBe(false);
  });
});

function snapshot(sessionId: string, done: boolean) {
  return {
    sessionId,
    done,
    state: { sessionId, goal: "test" } as AgentGraphState
  };
}
