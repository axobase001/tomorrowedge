export function reduceStderr(text: string, maxChars = 3200): string {
  const normalized = text.trimEnd();
  if (normalized.length <= maxChars) return normalized;
  return `[stderr tail; omitted ${normalized.length - maxChars} chars]\n${normalized.slice(-maxChars)}`;
}
