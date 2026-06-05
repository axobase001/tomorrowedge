import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentGraphState } from "../agentGraph/state.js";
import { appendLearnedTaskMemory } from "./taskMemory.js";
import type { TomorrowEdgeEvent } from "../events/eventTypes.js";
import { redactSessionRecord } from "../../safety/providerRedaction.js";

export type SessionRecord = {
  sessionId: string;
  createdAt: string;
  eventCount?: number;
  artifactCount?: number;
  state: AgentGraphState;
};

export type LatestSessionPointer = {
  sessionId: string;
  updatedAt: string;
  goal?: string;
};

export async function saveSession(cwd: string, state: AgentGraphState): Promise<string> {
  const sessionId = state.sessionId;
  const safeState = redactSessionRecord(state);
  const record: SessionRecord = redactSessionRecord({
    sessionId,
    createdAt: new Date().toISOString(),
    eventCount: safeState.events.length,
    artifactCount: safeState.eventArtifacts.length,
    state: {
      ...safeState,
      eventArtifacts: safeState.eventArtifacts.map((artifact) => ({ ref: artifact.ref, content: "[stored in artifact file]" }))
    }
  });
  const sessionDir = path.join(cwd, ".tomorrowedge", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  const filePath = path.join(sessionDir, "session.json");
  await writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
  await writeFile(path.join(sessionDir, "events.jsonl"), safeState.events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  for (const artifact of safeState.eventArtifacts) {
    const artifactPath = path.join(sessionDir, artifact.ref);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, artifact.content, "utf8");
  }
  await appendLearnedTaskMemory(cwd, safeState);
  await writeLatestSessionPointer(cwd, safeState);
  return filePath;
}

export async function loadSession(cwd: string, sessionId: string): Promise<SessionRecord> {
  const sessionDirPath = path.join(cwd, ".tomorrowedge", "sessions", sessionId, "session.json");
  const flatPath = path.join(cwd, ".tomorrowedge", "sessions", `${sessionId}.json`);
  const dirText = await readFile(sessionDirPath, "utf8").catch(() => undefined);
  if (dirText !== undefined) return redactSessionRecord(await hydrateEvents(JSON.parse(dirText) as SessionRecord, path.dirname(sessionDirPath)));
  const flatText = await readFile(flatPath, "utf8");
  return redactSessionRecord(await hydrateEvents(JSON.parse(flatText) as SessionRecord, path.dirname(flatPath)));
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
  const pointer = await readLatestSessionPointer(cwd);
  if (pointer?.sessionId) {
    const pinned = await loadSession(cwd, pointer.sessionId).catch(() => undefined);
    if (pinned) return pinned;
  }
  const [latest] = await listSessions(cwd);
  if (!latest) throw new Error("No sessions found.");
  return latest;
}

export async function writeLatestSessionPointer(cwd: string, state: Pick<AgentGraphState, "sessionId" | "goal">): Promise<void> {
  const dir = path.join(cwd, ".tomorrowedge");
  await mkdir(dir, { recursive: true });
  const pointer: LatestSessionPointer = {
    sessionId: state.sessionId,
    updatedAt: new Date().toISOString(),
    goal: state.goal
  };
  await writeFile(path.join(dir, "latest-session.json"), JSON.stringify(redactSessionRecord(pointer), null, 2), "utf8");
}

async function readLatestSessionPointer(cwd: string): Promise<LatestSessionPointer | undefined> {
  const pointerPath = path.join(cwd, ".tomorrowedge", "latest-session.json");
  const text = await readFile(pointerPath, "utf8").catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text) as LatestSessionPointer;
  } catch {
    return undefined;
  }
}

async function hydrateEvents(record: SessionRecord, sessionDir: string): Promise<SessionRecord> {
  if (record.state.events?.length) return record;
  const eventsPath = path.join(sessionDir, "events.jsonl");
  const events = (await readFile(eventsPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TomorrowEdgeEvent);
  return { ...record, state: { ...record.state, events, eventArtifacts: record.state.eventArtifacts ?? [] } };
}
