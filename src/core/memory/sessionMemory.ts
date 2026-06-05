import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentGraphState } from "../agentGraph/state.js";
import { appendLearnedTaskMemory } from "./taskMemory.js";
import type { TomorrowEdgeEvent } from "../events/eventTypes.js";
import { redactSessionRecord, redactText } from "../../safety/secretScanner.js";

export type SessionRecord = {
  sessionId: string;
  createdAt: string;
  eventCount?: number;
  artifactCount?: number;
  state: AgentGraphState;
};

export async function saveSession(cwd: string, state: AgentGraphState): Promise<string> {
  const sessionId = state.sessionId;
  const record: SessionRecord = {
    sessionId,
    createdAt: new Date().toISOString(),
    eventCount: state.events.length,
    artifactCount: state.eventArtifacts.length,
    state: {
      ...state,
      eventArtifacts: state.eventArtifacts.map((artifact) => ({ ref: artifact.ref, content: "[stored in artifact file]" }))
    }
  };
  const redactedRecord = redactSessionRecord(record);
  const redactedEvents = redactSessionRecord(state.events);
  const sessionDir = path.join(cwd, ".tomorrowedge", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  const filePath = path.join(sessionDir, "session.json");
  await writeFile(filePath, JSON.stringify(redactedRecord, null, 2), "utf8");
  await writeFile(path.join(sessionDir, "events.jsonl"), redactedEvents.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  for (const artifact of state.eventArtifacts) {
    const artifactPath = path.join(sessionDir, artifact.ref);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, redactText(artifact.content), "utf8");
  }
  await appendLearnedTaskMemory(cwd, state);
  return filePath;
}

export async function loadSession(cwd: string, sessionId: string): Promise<SessionRecord> {
  const sessionDirPath = path.join(cwd, ".tomorrowedge", "sessions", sessionId, "session.json");
  const flatPath = path.join(cwd, ".tomorrowedge", "sessions", `${sessionId}.json`);
  const text = await readFile(sessionDirPath, "utf8").catch(() => readFile(flatPath, "utf8"));
  return redactSessionRecord(await hydrateEvents(JSON.parse(text) as SessionRecord, path.dirname(sessionDirPath)));
}

export async function listSessions(cwd: string): Promise<Array<SessionRecord & { path: string }>> {
  const dir = path.join(cwd, ".tomorrowedge", "sessions");
  const names = await readdir(dir).catch(() => []);
  const records = await Promise.all(
    names
      .filter((name) => name.endsWith(".json") || !name.includes("."))
      .map(async (name) => {
        const filePath = name.endsWith(".json") ? path.join(dir, name) : path.join(dir, name, "session.json");
        const record = JSON.parse(await readFile(filePath, "utf8")) as SessionRecord;
        return redactSessionRecord({ ...record, path: filePath });
      })
  );
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadLatestSession(cwd: string): Promise<SessionRecord> {
  const [latest] = await listSessions(cwd);
  if (!latest) throw new Error("No sessions found.");
  return latest;
}

async function hydrateEvents(record: SessionRecord, sessionDir: string): Promise<SessionRecord> {
  if (record.state.events?.length) return record;
  const eventsPath = path.join(sessionDir, "events.jsonl");
  const events = (await readFile(eventsPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TomorrowEdgeEvent);
  return { ...record, state: { ...record.state, events: redactSessionRecord(events), eventArtifacts: record.state.eventArtifacts ?? [] } };
}
