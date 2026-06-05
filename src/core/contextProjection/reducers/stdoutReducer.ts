export function reduceStdout(text: string, maxChars = 2400): string {
  const normalized = text.trimEnd();
  if (normalized.length <= maxChars) return normalized;
  return `[stdout tail; omitted ${normalized.length - maxChars} chars]\n${normalized.slice(-maxChars)}`;
}
