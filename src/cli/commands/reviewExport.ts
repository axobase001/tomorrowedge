import { loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { buildReviewCommentDrafts, renderReviewCommentDrafts, type ReviewCommentExportFormat } from "../../core/review/commentExport.js";

export async function reviewExportCommand(cwd: string, sessionId: string, options: { format?: ReviewCommentExportFormat } = {}): Promise<void> {
  const format = options.format === "google-docs" ? "google-docs" : "github";
  const session = sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  const drafts = buildReviewCommentDrafts(session, format);
  process.stdout.write(renderReviewCommentDrafts(drafts, format) + "\n");
}
