import { spawn } from "node:child_process";
import type { Repo } from "./repos";

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function shellQuote(arg: string): string {
  if (arg.length > 0 && SHELL_SAFE.test(arg)) return arg;
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

export function resolveCommand(
  commandOrTask: string,
  args: string[],
  tasks: Record<string, string>,
): string {
  const command = tasks[commandOrTask] ?? commandOrTask;
  if (args.length === 0) return command;
  return `${command} ${args.map(shellQuote).join(" ")}`;
}

export function filterReposByMatch(repos: Repo[], pattern?: string): Repo[] {
  if (!pattern) return repos;
  const regex = new RegExp(pattern);
  return repos.filter((repo) => regex.test(repo.key));
}

export function envWithoutFinalizer(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const { PROJJ_FINALIZER_FILE: _finalizerFile, ...safeEnv } = env;
  return safeEnv;
}

export async function runShellCommand(command: string, cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      env: envWithoutFinalizer(),
      shell: true,
      stdio: "inherit",
    });

    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}
