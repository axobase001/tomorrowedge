import type { TerminalBenchAction, TerminalBenchActionParseResult, TerminalBenchFilePatch } from "./types.js";

const DEFAULT_ACTION: TerminalBenchAction = {
  thought: "",
  files: [],
  commands: [],
  verify: true,
  done: false
};

export function parseTerminalBenchAction(raw: string): TerminalBenchActionParseResult {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "terminal action must be a JSON object",
      rawExcerpt: raw.trim().slice(0, 500)
    };
  }
  const warnings: string[] = [];
  const record = normalizeActionRecord(parsed as Record<string, unknown>);
  const commands = normalizeCommands(record.commands, warnings);
  const files = normalizeFiles(record.files, warnings);
  const done = Boolean(record.done ?? record.finished ?? false);
  const action: TerminalBenchAction = {
    ...DEFAULT_ACTION,
    thought: normalizeText(record.thought ?? record.reason ?? record.summary),
    commands,
    files,
    verify: record.verify === undefined ? true : Boolean(record.verify),
    done
  };
  if (action.done && action.commands.length > 0) {
    warnings.push("done=true ignored while commands are present");
    action.done = false;
  }
  return { ok: true, action, warnings };
}

function normalizeActionRecord(record: Record<string, unknown>): Record<string, unknown> {
  let normalized = record;
  for (const key of ["action", "next_action", "terminal_action", "rescue_action"]) {
    const nested = record[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      normalized = { ...record, ...(nested as Record<string, unknown>) };
      break;
    }
  }
  if (normalized.commands === undefined) {
    normalized.commands = normalized.command ?? normalized.shell_command ?? normalized.shell;
  }
  if (
    normalized.files === undefined &&
    normalized.file &&
    typeof normalized.file === "object" &&
    !Array.isArray(normalized.file)
  ) {
    normalized.files = [normalized.file];
  }
  if (normalized.files === undefined) {
    normalized.files = normalized.write_files ?? normalized.artifacts;
  }
  return normalized;
}

export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with fenced/embedded extraction below.
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Continue with balanced extraction below.
    }
  }
  const start = trimmed.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function normalizeCommands(value: unknown, warnings: string[]): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeFiles(value: unknown, warnings: string[]): TerminalBenchFilePatch[] {
  if (!Array.isArray(value)) return [];
  const files: TerminalBenchFilePatch[] = [];
  for (const item of value.slice(0, 8)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      warnings.push("ignored non-object file entry");
      continue;
    }
    const record = item as Record<string, unknown>;
    const path = normalizePath(record.path);
    const content = typeof record.content === "string" ? record.content : undefined;
    const encoding = record.encoding === "base64" ? "base64" : "utf8";
    if (!path || content === undefined) {
      warnings.push("ignored file entry without safe path/content");
      continue;
    }
    files.push({ path, content, encoding });
  }
  return files;
}

export function normalizePath(pathValue: unknown): string | undefined {
  if (typeof pathValue !== "string") return undefined;
  let normalized = pathValue.trim().replace(/\\/g, "/");
  if (!normalized) return undefined;
  if (normalized.startsWith("/app/")) return normalized;
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) return undefined;
  return `/app/${normalized}`;
}

export function splitHereDocCommand(command: string): { file: TerminalBenchFilePatch; remainder: string } | undefined {
  const marker = command.match(/cat\s+>\s+([^\s]+)\s+<<['"]?([A-Za-z0-9_.-]+)['"]?\r?\n/);
  if (!marker || marker.index === undefined) return undefined;
  const path = normalizePath(marker[1]);
  if (!path) return undefined;
  const delimiter = marker[2];
  const contentStart = marker.index + marker[0].length;
  const delimiterPrefix = `\n${delimiter}`;
  const delimiterStart = command.indexOf(delimiterPrefix, contentStart);
  if (delimiterStart < 0) return undefined;
  const delimiterLineEnd = command.indexOf("\n", delimiterStart + delimiterPrefix.length);
  const content = command.slice(contentStart, delimiterStart);
  const remainder = delimiterLineEnd < 0 ? "" : command.slice(delimiterLineEnd + 1).trim();
  return { file: { path, content, encoding: "utf8" }, remainder };
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 2000) : "";
}
