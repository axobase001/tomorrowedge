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
  if (!unifiedDiff.trim()) return [];
  if (/GIT binary patch|Binary files .+ differ/i.test(unifiedDiff)) {
    return parseBinaryPatchTargets(unifiedDiff);
  }
  return parsePatch(unifiedDiff).map((file) => ({
    oldFileName: stripPrefix(file.oldFileName ?? ""),
    newFileName: stripPrefix(file.newFileName ?? ""),
    hunks: file.hunks.length,
    isCreate: isDevNull(file.oldFileName),
    isDelete: isDevNull(file.newFileName),
    isRename: Boolean(file.oldFileName && file.newFileName && stripPrefix(file.oldFileName) !== stripPrefix(file.newFileName) && !isDevNull(file.oldFileName) && !isDevNull(file.newFileName)),
    isBinary: /GIT binary patch|Binary files .+ differ/i.test(unifiedDiffForFile(unifiedDiff, file.oldFileName, file.newFileName))
  }));
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

function unifiedDiffForFile(unifiedDiff: string, oldFileName?: string, newFileName?: string): string {
  const oldHeader = oldFileName ? `--- ${oldFileName}` : "";
  const newHeader = newFileName ? `+++ ${newFileName}` : "";
  const start = oldHeader ? unifiedDiff.indexOf(oldHeader) : -1;
  if (start < 0) return "";
  const next = unifiedDiff.indexOf("\n--- ", start + oldHeader.length);
  const chunk = next < 0 ? unifiedDiff.slice(start) : unifiedDiff.slice(start, next);
  return newHeader && !chunk.includes(newHeader) ? "" : chunk;
}
