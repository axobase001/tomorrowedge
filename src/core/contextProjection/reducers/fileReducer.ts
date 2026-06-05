export function reduceFile(text: string, maxHead = 1600, maxTail = 1600): string {
  if (text.length <= maxHead + maxTail + 200) return text;
  return `${text.slice(0, maxHead)}\n[file middle omitted ${text.length - maxHead - maxTail} chars]\n${text.slice(-maxTail)}`;
}
