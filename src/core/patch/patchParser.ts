import { parsePatch } from "diff";

export type ParsedPatchFile = {
  oldFileName: string;
  newFileName: string;
  hunks: number;
  isCreate: boolean;
  isDelete: boolean;
  isRename: boolean;
  isBinary: boolean;
};

export function parseUnifiedDiff(unifiedDiff: string): ParsedPatchFile[] {
  const normalizedDiff = normalizeUnifiedDiffHunkCounts(unifiedDiff);
  if (!normalizedDiff.trim()) return [];
  if (/GIT binary patch|Binary files .+ differ/i.test(normalizedDiff)) {
    return parseBinaryPatchTargets(normalizedDiff);
  }
  return parsePatch(normalizedDiff).map((file) => ({
    oldFileName: stripPrefix(file.oldFileName ?? ""),
    newFileName: stripPrefix(file.newFileName ?? ""),
    hunks: file.hunks.length,
    isCreate: isDevNull(file.oldFileName),
    isDelete: isDevNull(file.newFileName),
    isRename: Boolean(file.oldFileName && file.newFileName && stripPrefix(file.oldFileName) !== stripPrefix(file.newFileName) && !isDevNull(file.oldFileName) && !isDevNull(file.newFileName)),
    isBinary: /GIT binary patch|Binary files .+ differ/i.test(unifiedDiffForFile(normalizedDiff, file.oldFileName, file.newFileName))
  }));
}

export function normalizeUnifiedDiffHunkCounts(unifiedDiff: string): string {
  const lines = unifiedDiff.split("\n");
  const normalized: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    const match = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (!match) {
      normalized.push(header);
      continue;
    }

    const hunkLines: string[] = [];
    let oldLines = 0;
    let newLines = 0;
    let cursor = index + 1;
    while (cursor < lines.length && !isPatchBoundary(lines[cursor])) {
      const line = lines[cursor] === "" ? " " : lines[cursor];
      hunkLines.push(line);
      if (line.startsWith("\\ No newline")) {
        cursor += 1;
        continue;
      }
      const operation = line[0];
      if (operation === " " || operation === "-") oldLines += 1;
      if (operation === " " || operation === "+") newLines += 1;
      cursor += 1;
    }

    normalized.push(`@@ -${match[1]},${oldLines} +${match[2]},${newLines} @@${match[3]}`);
    normalized.push(...hunkLines);
    index = cursor - 1;
  }
  return normalized.join("\n");
}

function parseBinaryPatchTargets(unifiedDiff: string): ParsedPatchFile[] {
  const oldMatch = unifiedDiff.match(/^---\s+(.+)$/m);
  const newMatch = unifiedDiff.match(/^\+\+\+\s+(.+)$/m);
  const oldFileName = stripPrefix(oldMatch?.[1] ?? "");
  const newFileName = stripPrefix(newMatch?.[1] ?? "");
  return [
    {
      oldFileName,
      newFileName,
      hunks: 0,
      isCreate: isDevNull(oldMatch?.[1]),
      isDelete: isDevNull(newMatch?.[1]),
      isRename: Boolean(oldFileName && newFileName && oldFileName !== newFileName),
      isBinary: true
    }
  ];
}

export function stripPrefix(fileName: string): string {
  if (isDevNull(fileName)) return "";
  return fileName.replace(/^[ab]\//, "");
}

function isDevNull(fileName?: string): boolean {
  return fileName === "/dev/null" || fileName === "dev/null";
}

function isPatchBoundary(line: string): boolean {
  return line.startsWith("@@ ") || line.startsWith("--- ") || line.startsWith("diff --git ");
}

function unifiedDiffForFile(unifiedDiff: string, oldFileName?: string, newFileName?: string): string {
  const oldHeader = oldFileName ? `--- ${oldFileName}` : "";
  const newHeader = newFileName ? `+++ ${newFileName}` : "";
  const start = oldHeader ? unifiedDiff.indexOf(oldHeader) : -1;
  if (start < 0) return "";
  const next = unifiedDiff.indexOf("\n--- ", start + oldHeader.length);
  const chunk = next < 0 ? unifiedDiff.slice(start) : unifiedDiff.slice(start, next);
  return newHeader && !chunk.includes(newHeader) ? "" : chunk;
}
