import type { HookConfig } from "./config";
import type { RepoInfo } from "./git-url";
import type { Output } from "./output";
import type { Repo } from "./repos";
import {
  filterReposBySelector,
  runShellCommand as defaultRunShellCommand,
} from "./run";
import { resolveRunCommand } from "./tasks";

export type HookEvent = "post_clone";

type RunHooksOptions = {
  event: HookEvent;
  hooks: HookConfig[];
  repo: RepoInfo;
  repoPath: string;
  globalTasks: Record<string, string>;
  output: Output;
  runShellCommand?: typeof defaultRunShellCommand;
};

export function selectHooks(
  hooks: HookConfig[],
  event: HookEvent,
  repo: RepoInfo,
): HookConfig[] {
  return hooks.filter((hook) => {
    if (hook.event !== event) return false;
    if (!hook.filter) return true;
    return filterReposBySelector([repoToSelectorRepo(repo)], hook.filter).length > 0;
  });
}

export function buildHookEnv(
  event: HookEvent,
  repo: RepoInfo,
  repoPath: string,
): Record<string, string> {
  return {
    PROJJ_EVENT: event,
    PROJJ_REPO_PATH: repoPath,
    PROJJ_REPO_HOST: repo.host,
    PROJJ_REPO_OWNER: repo.owner,
    PROJJ_REPO_NAME: repo.repo,
    PROJJ_REPO_URL: repo.cloneUrl,
  };
}

export async function runHooks(options: RunHooksOptions): Promise<number> {
  const hooks = selectHooks(options.hooks, options.event, options.repo);
  const runShellCommand = options.runShellCommand ?? defaultRunShellCommand;
  const env = buildHookEnv(options.event, options.repo, options.repoPath);

  for (const hook of hooks) {
    for (const task of hook.tasks) {
      options.output.stdout(`hook ${options.event}: ${task}\n`);
      const command = await resolveRunCommand(task, [], options.globalTasks, options.repoPath);
      options.output.stdout(`$ ${command}\n`);
      const code = await runShellCommand(command, options.repoPath, { env });
      if (code !== 0) {
        options.output.stderr(`hook ${options.event} failed: ${task} exited ${code}\n`);
        return code;
      }
    }
  }

  return 0;
}

function repoToSelectorRepo(repo: RepoInfo): Repo {
  const path = `/${repo.host}/${repo.owner}/${repo.repo}`;
  return {
    base: "/",
    host: repo.host,
    owner: repo.owner,
    name: repo.repo,
    path,
    key: `${repo.host}/${repo.owner}/${repo.repo}`,
  };
}
