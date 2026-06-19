import { EventEmitter } from "node:events";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import type { TomorrowEdgeEvent } from "../core/events/eventTypes.js";

export type CockpitRunSnapshot = {
  sessionId: string;
  state: AgentGraphState;
  done: boolean;
  error?: string;
};

export class CockpitEventBus {
  private readonly emitter = new EventEmitter();
  private readonly snapshots = new Map<string, CockpitRunSnapshot>();
  private readonly canceledSessions = new Set<string>();

  emitEvent(sessionId: string, event: TomorrowEdgeEvent): void {
    this.emitter.emit(sessionId, { kind: "event", event });
  }

  setSnapshot(snapshot: CockpitRunSnapshot): void {
    this.snapshots.set(snapshot.sessionId, snapshot);
    this.emitter.emit(snapshot.sessionId, { kind: "snapshot", snapshot });
  }

  cancelSession(sessionId: string): void {
    this.canceledSessions.add(sessionId);
  }

  isCanceled(sessionId: string): boolean {
    return this.canceledSessions.has(sessionId);
  }

  getSnapshot(sessionId: string): CockpitRunSnapshot | undefined {
    return this.snapshots.get(sessionId);
  }

  subscribe(sessionId: string, listener: (message: unknown) => void): () => void {
    this.emitter.on(sessionId, listener);
    return () => this.emitter.off(sessionId, listener);
  }
}

export const cockpitEventBus = new CockpitEventBus();
