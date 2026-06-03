import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentGraphState } from "../agentGraph/state.js";
import { makeId } from "../../utils/ids.js";
import { appendLearnedTaskMemory } from "./taskMemory.js";

export type SessionRecord = {
  sessionId: string;
  createdAt: string;
  state: AgentGraphState;
};

export async function saveSession(cwd: string, state: AgentGraphState): Promise<string> {
  const sessionId = makeId("session");
  const record: SessionRecord = {
    sessionId,
    createdAt: new Date().toISOString(),
    state
  };
  const dir = path.join(cwd, ".tomorrowedge", "sessions");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${sessionId}.json`);
  await writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
  await appendLearnedTaskMemory(cwd, state);
  return filePath;
}

export async function loadSession(cwd: string, sessionId: string): Promise<SessionRecord> {
  const filePath = path.join(cwd, ".tomorrowedge", "sessions", `${sessionId}.json`);
  return JSON.parse(await readFile(filePath, "utf8")) as SessionRecord;
}

export async function listSessions(cwd: string): Promise<Array<SessionRecord & { path: string }>> {
  const dir = path.join(cwd, ".tomorrowedge", "sessions");
  const names = await readdir(dir).catch(() => []);
  const records = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const filePath = path.join(dir, name);
        const record = JSON.parse(await readFile(filePath, "utf8")) as SessionRecord;
        return { ...record, path: filePath };
      })
  );
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadLatestSession(cwd: string): Promise<SessionRecord> {
  const [latest] = await listSessions(cwd);
  if (!latest) throw new Error("No sessions found.");
  return latest;
}
