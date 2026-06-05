import { execa } from "execa";
import { loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { renderGithubPrReport } from "../../core/github/prReport.js";

export type GithubReportOptions = {
  repo?: string;
  pr?: string;
  dryRun?: boolean;
  postComment?: boolean;
};

export async function githubReportCommand(cwd: string, sessionId = "latest", options: GithubReportOptions = {}): Promise<void> {
  const session = sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  const body = renderGithubPrReport(session);

  if (!options.postComment || options.dryRun) {
    process.stdout.write(`${body}\n`);
    return;
  }

  const repo = options.repo?.trim();
  const pr = parsePrNumber(options.pr);
  if (!repo) throw new Error("--repo owner/name is required with --post-comment.");
  if (!pr) throw new Error("--pr <number> is required with --post-comment.");

  const result = await execa("gh", ["pr", "comment", String(pr), "--repo", repo, "--body-file", "-"], {
    input: body,
    reject: false,
    all: true
  });
  if (result.exitCode !== 0) {
    throw new Error(`gh pr comment failed: ${result.all || result.stderr || result.stdout || "unknown error"}`);
  }
  process.stdout.write(`posted TomorrowEdge report to ${repo}#${pr}\n`);
}

function parsePrNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
