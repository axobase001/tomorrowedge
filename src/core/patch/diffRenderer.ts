export function renderDiffSummary(unifiedDiff: string): string {
  if (!unifiedDiff.trim()) return "No diff proposed.";
  const added = unifiedDiff.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const removed = unifiedDiff.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  return `Diff preview: +${added} / -${removed}`;
}
