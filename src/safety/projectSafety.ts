import { simpleGit } from "simple-git";
import type { AccessMode } from "../config/schema.js";

export type ProjectSafetyResult = {
  gitRepo: boolean;
  branch?: string;
  dirty: boolean;
  createdBranch?: string;
  summary: string;
};

const protectedBranches = new Set(["main", "master"]);

export async function prepareProjectSafety(cwd: string, accessMode: AccessMode, sessionId: string): Promise<ProjectSafetyResult> {
  if (accessMode !== "full") {
    return { gitRepo: false, dirty: false, summary: "project safety branch guard only applies to full access mode" };
  }

  const git = simpleGit(cwd);
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    return { gitRepo: false, dirty: false, summary: "workspace is not a git repository; full mode branch guard skipped" };
  }

  const status = await git.status();
  const branch = status.current || "HEAD";
  const dirty = !status.isClean();
  if (protectedBranches.has(branch) && dirty) {
    throw new Error(`Full mode blocked on dirty ${branch}: commit, stash, or switch to a clean work branch before autonomous patch/shell execution.`);
  }

  if (protectedBranches.has(branch)) {
    const createdBranch = await createFullModeBranch(git, sessionId);
    return {
      gitRepo: true,
      branch,
      dirty,
      createdBranch,
      summary: `full mode moved from protected ${branch} to ${createdBranch}`
    };
  }

  return {
    gitRepo: true,
    branch,
    dirty,
    summary: dirty ? `full mode allowed on existing dirty work branch ${branch}` : `full mode running on work branch ${branch}`
  };
}

async function createFullModeBranch(git: ReturnType<typeof simpleGit>, sessionId: string): Promise<string> {
  const base = `tedge/full-${sessionId.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 48)}`;
  let branch = base;
  for (let attempt = 2; attempt < 20; attempt += 1) {
    if (!(await branchExists(git, branch))) {
      await git.checkoutLocalBranch(branch);
      return branch;
    }
    branch = `${base}-${attempt}`;
  }
  throw new Error(`Unable to create a unique full mode safety branch for ${sessionId}.`);
}

async function branchExists(git: ReturnType<typeof simpleGit>, branch: string): Promise<boolean> {
  const branches = await git.branchLocal();
  return branches.all.includes(branch);
}
