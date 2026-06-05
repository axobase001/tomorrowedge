export function reduceTestLog(text: string, maxChars = 3200): string {
  const lines = text.split(/\r?\n/);
  const signalLines = lines.filter((line) => /\b(fail|failed|error|pass|passed|assert|assertion|assertionerror|exception|traceback)\b/i.test(line));
  const signal = signalLines.slice(-40).join("\n");
  const fallback = text.length <= maxChars ? text : text.slice(-maxChars);
  if (!signal) return fallback.trimEnd();
  const tail = fallback.trimEnd();
  if (!tail || tail === signal || tail.includes(signal)) return tail || signal.trimEnd();
  const header = [`Signal lines:`, signal, "", "Log tail:"].join("\n");
  const tailBudget = Math.max(0, maxChars - header.length - 1);
  const visibleTail = tail.length <= tailBudget ? tail : tail.slice(-tailBudget).trimStart();
  return [header, visibleTail].join("\n").trimEnd();
}
