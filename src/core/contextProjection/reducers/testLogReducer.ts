export function reduceTestLog(text: string, maxChars = 3200): string {
  const lines = text.split(/\r?\n/);
  const signalLines = lines.filter((line) => /\b(fail|failed|error|pass|passed|assert|exception|traceback)\b/i.test(line));
  const signal = signalLines.slice(-40).join("\n");
  const fallback = text.length <= maxChars ? text : text.slice(-maxChars);
  return (signal || fallback).trimEnd();
}
