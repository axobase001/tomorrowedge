import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TomorrowEdgeEvent } from "./eventTypes.js";

export async function loadSessionEvents(sessionPath: string): Promise<TomorrowEdgeEvent[]> {
  const eventPath = sessionPath.endsWith("session.json") ? path.join(path.dirname(sessionPath), "events.jsonl") : sessionPath.replace(/\.json$/, ".events.jsonl");
  const text = await readFile(eventPath, "utf8").catch(() => "");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TomorrowEdgeEvent);
}
