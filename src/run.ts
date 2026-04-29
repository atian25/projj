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

export function filterReposBySelector(repos: Repo[], selector?: string): Repo[] {
  const normalizedSelector = selector?.trim();
  if (!normalizedSelector) return repos;

  if (normalizedSelector.includes("*")) {
    const regex = globToRegex(normalizedSelector);
    return repos.filter((repo) => repoSelectorFields(repo).some((field) => regex.test(field)));
  }

  const needle = normalizedSelector.toLowerCase();
  return repos.filter((repo) =>
    repoSelectorFields(repo).some((field) => field.toLowerCase().includes(needle)),
  );
}

function repoSelectorFields(repo: Repo): string[] {
  return [repo.name, `${repo.owner}/${repo.name}`, repo.key];
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function envWithoutFinalizer(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const { PROJJ_FINALIZER_FILE: _finalizerFile, ...safeEnv } = env;
  return safeEnv;
}

type ShellSpawn = (
  command: string,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: true;
    stdio: "inherit";
  },
) => {
  on(
    event: "error" | "close",
    listener: (() => void) | ((code: number | null) => void),
  ): unknown;
};

type RunShellCommandOptions = {
  env?: Record<string, string>;
  baseEnv?: NodeJS.ProcessEnv;
  spawn?: ShellSpawn;
};

export async function runShellCommand(
  command: string,
  cwd: string,
  options: RunShellCommandOptions = {},
): Promise<number> {
  return new Promise((resolve) => {
    const baseEnv = envWithoutFinalizer(options.baseEnv);
    const child = (options.spawn ?? spawn)(command, {
      cwd,
      env: { ...baseEnv, ...options.env },
      shell: true,
      stdio: "inherit",
    });

    child.on("error", () => resolve(1));
    child.on("close", (code: number | null) => resolve(code ?? 1));
  });
}
