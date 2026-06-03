import { simpleGit } from "simple-git";

export async function getGitStatus(cwd: string): Promise<string> {
  const git = simpleGit(cwd);
  const status = await git.status();
  return status.isClean() ? "clean" : `${status.files.length} changed file(s)`;
}
