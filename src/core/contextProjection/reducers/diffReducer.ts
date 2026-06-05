export function reduceDiff(text: string, maxFiles = 8, maxChars = 5000): string {
  const files = [...text.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => match[2]);
  const hunks = (text.match(/^@@ .+ @@/gm) ?? []).slice(0, 20);
  const header = [
    `Diff files: ${files.slice(0, maxFiles).join(", ") || "unknown"}`,
    files.length > maxFiles ? `Additional files omitted: ${files.length - maxFiles}` : "",
    hunks.length ? `Hunks: ${hunks.join(" | ")}` : ""
  ].filter(Boolean).join("\n");
  const body = text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n[diff preview omitted ${text.length - maxChars} chars]`;
  return `${header}\n\n${body}`.trim();
}
