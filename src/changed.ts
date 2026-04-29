import { spawn } from "node:child_process";

export type RepoChangeStatus =
  | { kind: "changed" }
  | { kind: "clean" }
  | { kind: "error"; exitCode: number };

type GitStatusRunner = (cwd: string) => Promise<{ exitCode: number; stdout: string }>;

type GetRepoChangeStatusOptions = {
  run?: GitStatusRunner;
};

export async function getRepoChangeStatus(
  cwd: string,
  options: GetRepoChangeStatusOptions = {},
): Promise<RepoChangeStatus> {
  const result = await (options.run ?? runGitStatusShort)(cwd);
  if (result.exitCode !== 0) return { kind: "error", exitCode: result.exitCode };
  return result.stdout.trim().length > 0 ? { kind: "changed" } : { kind: "clean" };
}

async function runGitStatusShort(cwd: string): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", ["status", "--short"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => resolve({ exitCode: 1, stdout }));
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout }));
  });
}
