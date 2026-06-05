import { execa } from "execa";
import { loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { renderGithubPrReport } from "../../core/github/prReport.js";

export type GithubReportOptions = {
  repo?: string;
  pr?: string;
  sha?: string;
  dryRun?: boolean;
  postComment?: boolean;
  postCheck?: boolean;
  checkName?: string;
};

export async function githubReportCommand(cwd: string, sessionId = "latest", options: GithubReportOptions = {}): Promise<void> {
  const session = sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  const body = renderGithubPrReport(session);

  if ((!options.postComment && !options.postCheck) || options.dryRun) {
    process.stdout.write(`${body}\n`);
    return;
  }

  const repo = options.repo?.trim();
  const pr = parsePrNumber(options.pr);
  if (!repo) throw new Error("--repo owner/name is required with --post-comment or --post-check.");
  if (options.postComment && !pr) throw new Error("--pr <number> is required with --post-comment.");

  if (options.postComment) {
    await postPrComment(repo, pr!, body);
    process.stdout.write(`posted TomorrowEdge report comment to ${repo}#${pr}\n`);
  }

  if (options.postCheck) {
    const sha = options.sha?.trim() || (pr ? await resolvePrHeadSha(repo, pr) : undefined);
    if (!sha) throw new Error("--sha <commit> or --pr <number> is required with --post-check.");
    await postCheckRun(repo, sha, options.checkName?.trim() || "TomorrowEdge report", body, checkConclusionFromReport(body));
    process.stdout.write(`posted TomorrowEdge check run to ${repo}@${sha}\n`);
  }
}

async function postPrComment(repo: string, pr: number, body: string): Promise<void> {
  const result = await execa("gh", ["pr", "comment", String(pr), "--repo", repo, "--body-file", "-"], {
    input: body,
    reject: false,
    all: true
  });
  if (result.exitCode !== 0) {
    throw new Error(`gh pr comment failed: ${result.all || result.stderr || result.stdout || "unknown error"}`);
  }
}

async function resolvePrHeadSha(repo: string, pr: number): Promise<string | undefined> {
  const result = await execa("gh", ["pr", "view", String(pr), "--repo", repo, "--json", "headRefOid", "--jq", ".headRefOid"], {
    reject: false,
    all: true
  });
  if (result.exitCode !== 0) {
    throw new Error(`gh pr view failed: ${result.all || result.stderr || result.stdout || "unknown error"}`);
  }
  return result.stdout.trim() || undefined;
}

async function postCheckRun(repo: string, sha: string, name: string, body: string, conclusion: "success" | "failure"): Promise<void> {
  const result = await execa("gh", [
    "api",
    "--method",
    "POST",
    `repos/${repo}/check-runs`,
    "-f",
    `name=${name}`,
    "-f",
    `head_sha=${sha}`,
    "-f",
    "status=completed",
    "-f",
    `conclusion=${conclusion}`,
    "-f",
    "output[title]=TomorrowEdge Report",
    "-f",
    `output[summary]=${body.slice(0, 65_000)}`
  ], {
    reject: false,
    all: true
  });
  if (result.exitCode !== 0) {
    throw new Error(`gh check run creation failed: ${result.all || result.stderr || result.stdout || "unknown error"}`);
  }
}

function checkConclusionFromReport(body: string): "success" | "failure" {
  return /success=false|exit=[1-9]\d*/.test(body) ? "failure" : "success";
}

function parsePrNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
