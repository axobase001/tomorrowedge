import type { AccessMode } from "../../config/schema.js";
import { redactText, redactValue } from "../../safety/secretScanner.js";
import { makeId } from "../../utils/ids.js";
import type { BaseEvent, EventArtifact, EventPhase, TomorrowEdgeEvent } from "./eventTypes.js";

type EventInput = Record<string, unknown> & {
  type: TomorrowEdgeEvent["type"];
  phase: EventPhase;
} & Partial<Pick<BaseEvent, "role" | "provider" | "model">>;

export class EventLedger {
  readonly events: TomorrowEdgeEvent[] = [];
  readonly artifacts: EventArtifact[] = [];

  constructor(
    readonly sessionId: string,
    private readonly mode: AccessMode
  ) {}

  append(event: EventInput): TomorrowEdgeEvent {
    const fullEvent = {
      ...redactValue(event),
      id: makeId(event.type),
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      mode: this.mode
    } as TomorrowEdgeEvent;
    this.events.push(fullEvent);
    return fullEvent;
  }

  writeArtifact(kind: string, content: string, extension = "txt"): string {
    const ref = `artifacts/${kind}/${makeId(kind)}.${extension}`;
    this.artifacts.push({ ref, content: redactText(content) });
    return ref;
  }
}

export function createEventLedger(mode: AccessMode, sessionId = makeId("session")): EventLedger {
  return new EventLedger(sessionId, mode);
}
