import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RepoInfo } from "./git-url";

export type CloneRunner = (cmd: string[]) => Promise<{ exitCode: number }>;

export function targetPathForRepo(base: string, info: RepoInfo): string {
  return join(base, info.host, info.owner, info.repo);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function cloneRepo(
  cloneUrl: string,
  targetPath: string,
  runner: CloneRunner = runGitClone,
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const result = await runner(["git", "clone", cloneUrl, targetPath]);
  if (result.exitCode !== 0) {
    throw new Error(`git clone failed with exit code ${result.exitCode}`);
  }
}

async function runGitClone(cmd: string[]): Promise<{ exitCode: number }> {
  const child = Bun.spawn(cmd, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return { exitCode: await child.exited };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
