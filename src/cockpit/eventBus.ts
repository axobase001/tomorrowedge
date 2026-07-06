import { EventEmitter } from "node:events";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import type { TomorrowEdgeEvent } from "../core/events/eventTypes.js";

export type CockpitRunSnapshot = {
  sessionId: string;
  state: AgentGraphState;
  done: boolean;
  error?: string;
};

export type CockpitEventBusOptions = {
  maxSnapshots?: number;
  terminalSnapshotTtlMs?: number;
  canceledSessionTtlMs?: number;
  now?: () => number;
};

type SnapshotEntry = {
  snapshot: CockpitRunSnapshot;
  updatedAt: number;
  expiresAt?: number;
};

const defaultMaxSnapshots = 200;
const defaultTerminalSnapshotTtlMs = 10 * 60 * 1000;
const defaultCanceledSessionTtlMs = 10 * 60 * 1000;

export class CockpitEventBus {
  private readonly emitter = new EventEmitter();
  private readonly snapshots = new Map<string, SnapshotEntry>();
  private readonly canceledSessions = new Map<string, number>();
  private readonly maxSnapshots: number;
  private readonly terminalSnapshotTtlMs: number;
  private readonly canceledSessionTtlMs: number;
  private readonly now: () => number;

  constructor(options: CockpitEventBusOptions = {}) {
    this.maxSnapshots = Math.max(1, Math.floor(options.maxSnapshots ?? defaultMaxSnapshots));
    this.terminalSnapshotTtlMs = Math.max(0, options.terminalSnapshotTtlMs ?? defaultTerminalSnapshotTtlMs);
    this.canceledSessionTtlMs = Math.max(0, options.canceledSessionTtlMs ?? defaultCanceledSessionTtlMs);
    this.now = options.now ?? Date.now;
  }

  emitEvent(sessionId: string, event: TomorrowEdgeEvent): void {
    this.emitter.emit(sessionId, { kind: "event", event });
  }

  setSnapshot(snapshot: CockpitRunSnapshot): void {
    const now = this.now();
    this.prune(now);
    this.snapshots.set(snapshot.sessionId, {
      snapshot,
      updatedAt: now,
      expiresAt: snapshot.done ? now + this.terminalSnapshotTtlMs : undefined
    });
    this.enforceSnapshotLimit();
    this.emitter.emit(snapshot.sessionId, { kind: "snapshot", snapshot });
  }

  cancelSession(sessionId: string): void {
    const now = this.now();
    this.prune(now);
    this.canceledSessions.set(sessionId, now + this.canceledSessionTtlMs);
  }

  isCanceled(sessionId: string): boolean {
    this.prune(this.now());
    return this.canceledSessions.has(sessionId);
  }

  getSnapshot(sessionId: string): CockpitRunSnapshot | undefined {
    this.prune(this.now());
    return this.snapshots.get(sessionId)?.snapshot;
  }

  subscribe(sessionId: string, listener: (message: unknown) => void): () => void {
    this.emitter.on(sessionId, listener);
    return () => this.emitter.off(sessionId, listener);
  }

  private prune(now: number): void {
    for (const [sessionId, entry] of this.snapshots.entries()) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.snapshots.delete(sessionId);
    }
    for (const [sessionId, expiresAt] of this.canceledSessions.entries()) {
      if (expiresAt <= now) this.canceledSessions.delete(sessionId);
    }
  }

  private enforceSnapshotLimit(): void {
    if (this.snapshots.size <= this.maxSnapshots) return;
    const staleFirst = [...this.snapshots.entries()].sort(([, left], [, right]) => left.updatedAt - right.updatedAt);
    for (const [sessionId] of staleFirst.slice(0, this.snapshots.size - this.maxSnapshots)) {
      this.snapshots.delete(sessionId);
    }
  }
}

export const cockpitEventBus = new CockpitEventBus();
