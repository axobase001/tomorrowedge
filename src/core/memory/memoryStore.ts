import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TaskMemory } from "./taskMemory.js";
import { emptyTaskMemory } from "./taskMemory.js";

export function loadTaskMemory(cwd: string): TaskMemory {
  const filePath = path.join(cwd, ".tomorrowedge", "task-memory.json");
  if (!existsSync(filePath)) return emptyTaskMemory;
  return JSON.parse(readFileSync(filePath, "utf8")) as TaskMemory;
}

export async function saveTaskMemory(cwd: string, memory: TaskMemory): Promise<void> {
  const dir = path.join(cwd, ".tomorrowedge");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "task-memory.json"), JSON.stringify(memory, null, 2), "utf8");
}
