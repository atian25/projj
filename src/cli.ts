import { parseArgs } from "node:util";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { getRepoChangeStatus as defaultGetRepoChangeStatus } from "./changed";
import { createColorTheme, shouldUseColor } from "./color";
import { defaultConfig, defaultConfigPath, loadConfig, saveDefaultConfig } from "./config";
import type { ProjjConfig } from "./config";
import {
  cloneRepo as defaultCloneRepo,
  pathExists as defaultPathExists,
  targetPathForRepo,
} from "./git";
import { parseRepoInput } from "./git-url";
import type { RepoInfo } from "./git-url";
import { runHooks } from "./hooks";
import type { Output } from "./output";
import { formatError } from "./output";
import { findRepos, scanRepos } from "./repos";
import type { Repo } from "./repos";
import {
  filterReposBySelector,
  runShellCommand as defaultRunShellCommand,
} from "./run";
import { selectRepo } from "./select";
import { shellInit, writeCdFinalizer } from "./shell";
import type { SupportedShell } from "./shell";
import {
  explainTaskNotFound,
  formatTaskList,
  listRunTasks,
  resolveRunCommand,
  resolveStartCommand,
  resolveTaskCommand,
} from "./tasks";
import type { TaskNotFoundHint, TaskProviderKind } from "./tasks";

export type CliDeps = {
  stdout: Output["stdout"];
  stderr: Output["stderr"];
  env?: Record<string, string | undefined>;
  configPath?: string;
  home?: string;
  cwd?: string;
  cloneRepo?: typeof defaultCloneRepo;
  pathExists?: typeof defaultPathExists;
  runShellCommand?: typeof defaultRunShellCommand;
  getRepoChangeStatus?: typeof defaultGetRepoChangeStatus;
  color?: boolean;
};

const HELP = `projj

Usage:
  projj init
  projj clone <repo> [--base <path>] [--no-cd] [--dry-run]
  projj find [query] [--list]
  projj hooks run <event> [--all] [--filter <selector>] [--dry-run]
  projj run --list [--all] [--filter <selector>]
  projj run <task> [--all] [--filter <selector>] [-- ...args]
  projj start [--dry-run] [-- ...args]
  projj shell-init <zsh|bash|fish>
`;

const SHELL_INTEGRATION_HINT =
  'Auto-cd is not enabled. To install it, run: echo \'eval "$(projj shell-init zsh)"\' >> ~/.zshrc && source ~/.zshrc\n';

export function createCli(deps: CliDeps) {
  const output: Output = {
    stdout: deps.stdout,
    stderr: deps.stderr,
  };
  const env = deps.env ?? process.env;
  const home = deps.home ?? env.HOME ?? ".";
  const cwd = deps.cwd ?? process.cwd();
  const configPath = deps.configPath ?? defaultConfigPath(home);
  const cloneRepo = deps.cloneRepo ?? defaultCloneRepo;
  const pathExists = deps.pathExists ?? defaultPathExists;
  const runShellCommand = deps.runShellCommand ?? defaultRunShellCommand;
  const getRepoChangeStatus = deps.getRepoChangeStatus ?? defaultGetRepoChangeStatus;
  const colors = createColorTheme(
    deps.color ?? shouldUseColor(env, process.stdout.isTTY),
  );

  async function runTaskLifecycle(
    task: string,
    args: string[],
    runCwd: string,
    config: ProjjConfig,
    dryRun: boolean,
    dryRunHeading: string,
    notFoundMessage?: string,
    repo?: Repo,
    printCommand = false,
  ): Promise<number> {
    const taskCommand =
      task === "start"
        ? await resolveStartCommand(args, runCwd, config.tasks)
        : await resolveTaskCommand(task, args, config.tasks, runCwd);
    if (!taskCommand) {
      output.stderr(
        notFoundMessage ??
          formatTaskNotFoundMessage(await explainTaskNotFound(task, runCwd, config.tasks)),
      );
      return 1;
    }

    if (dryRun) {
      if (dryRunHeading) output.stdout(dryRunHeading);
      output.stdout(`${colors.command(`$ ${taskCommand}`)}\n`);
      return 0;
    }

    if (printCommand) output.stdout(`${colors.command(`$ ${taskCommand}`)}\n`);

    const currentRepo = repo ?? currentRepoFromBaseDirs(config.base, runCwd)[0];
    const repoInfo = currentRepo
      ? repoInfoFromScannedRepo(currentRepo)
      : repoInfoFromCurrentDirectory(runCwd);
    const preEvent = hookEventForTask("pre", task);
    const postEvent = hookEventForTask("post", task);

    if (preEvent) {
      const preHook = await runHooks({
        event: preEvent,
        hooks: config.hooks,
        repo: repoInfo,
        repoPath: runCwd,
        globalTasks: config.tasks,
        output,
        runShellCommand,
      });
      if (preHook.code !== 0) return preHook.code;
    }

    const taskCode = await runShellCommand(taskCommand, runCwd);
    if (taskCode !== 0) return taskCode;

    if (!postEvent) return 0;
    const postHook = await runHooks({
      event: postEvent,
      hooks: config.hooks,
      repo: repoInfo,
      repoPath: runCwd,
      globalTasks: config.tasks,
      output,
      runShellCommand,
    });
    return postHook.code;
  }

  async function runRawCommandInRepo(
    commandInput: string,
    args: string[],
    repo: Repo,
    config: ProjjConfig,
    dryRun: boolean,
  ): Promise<number> {
    const runCommand = await resolveRunCommand(commandInput, args, config.tasks, repo.path);
    output.stdout(`${colors.command(`$ ${runCommand}`)}\n`);
    if (dryRun) return 0;
    return runShellCommand(runCommand, repo.path);
  }

  return {
    async run(argv: string[]): Promise<number> {
      try {
        if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
          output.stdout(HELP);
          return 0;
        }

        const command = argv[0];
        const rest = argv.slice(1);

        switch (command) {
          case "init": {
            parseArgs({ args: rest, options: {}, allowPositionals: false });
            const path = configPath;
            const created = await saveDefaultConfig(path);
            output.stdout(created ? `created ${path}\n` : `exists ${path}\n`);
            return 0;
          }
          case "clone": {
            const parsed = parseArgs({
              args: rest,
              options: {
                base: { type: "string" },
                "dry-run": { type: "boolean", default: false },
                "no-cd": { type: "boolean", default: false },
              },
              allowPositionals: true,
            });

            if (parsed.positionals.length !== 1) {
              output.stderr("Usage: projj clone <repo> [--base <path>] [--no-cd] [--dry-run]\n");
              return 1;
            }
            const repoInput = parsed.positionals[0]!;

            const config = await loadConfig(configPath, home);
            const base =
              typeof parsed.values.base === "string"
                ? expandCliPath(parsed.values.base, home, cwd)
                : config.base[0];

            if (!base) {
              output.stderr("config base is empty; pass --base <path> or set base in config\n");
              return 1;
            }

            const repo = parseRepoInput(repoInput, config.platform);
            const targetPath = targetPathForRepo(base, repo);

            if (parsed.values["dry-run"]) {
              if (await pathExists(targetPath)) {
                output.stdout(`Would skip existing ${targetPath}\n`);
              } else {
                output.stdout(`Would clone ${repo.cloneUrl}\n`);
                output.stdout(`to ${targetPath}\n`);
              }
              return 0;
            }

            let cloned = false;
            if (await pathExists(targetPath)) {
              output.stdout(`exists ${targetPath}\n`);
            } else {
              await cloneRepo(repo.cloneUrl, targetPath);
              cloned = true;
              output.stdout(`cloned ${targetPath}\n`);
            }

            if (cloned) {
              const hookResult = await runHooks({
                event: "post_clone",
                hooks: config.hooks,
                repo,
                repoPath: targetPath,
                globalTasks: config.tasks,
                output,
                runShellCommand,
              });
              if (hookResult.code !== 0) return hookResult.code;
            }

            if (!parsed.values["no-cd"]) {
              if (await writeCdFinalizer(targetPath, env)) return 0;

              output.stdout(`${targetPath}\n`);
              output.stderr(SHELL_INTEGRATION_HINT);
            }

            return 0;
          }
          case "find": {
            const parsed = parseArgs({
              args: rest,
              options: { list: { type: "boolean", default: false } },
              allowPositionals: true,
            });
            if (parsed.positionals.length > 1) {
              output.stderr("Usage: projj find [query] [--list]\n");
              return 1;
            }

            const config = await loadConfig(configPath, home);
            const matches = findRepos(await scanRepos(config.base), parsed.positionals[0]);
            if (parsed.values.list) {
              for (const repo of matches) output.stdout(`${repo.path}\n`);
              return matches.length > 0 ? 0 : 1;
            }

            const repo = await selectRepo(matches);
            if (!repo) return 1;

            if (await writeCdFinalizer(repo.path, env)) return 0;

            output.stdout(`${repo.path}\n`);
            output.stderr(SHELL_INTEGRATION_HINT);
            return 0;
          }
          case "shell-init": {
            const parsed = parseArgs({ args: rest, options: {}, allowPositionals: true });
            const shell = parsed.positionals[0];
            if (parsed.positionals.length !== 1 || !shell || !isSupportedShell(shell)) {
              output.stderr("Usage: projj shell-init <zsh|bash|fish>\n");
              return 1;
            }

            output.stdout(shellInit(shell));
            return 0;
          }
          case "hooks": {
            const parsed = parseArgs({
              args: rest,
              options: {
                all: { type: "boolean", default: false },
                "dry-run": { type: "boolean", default: false },
                filter: { type: "string" },
              },
              allowPositionals: true,
            });
            const [subcommand, event, ...unexpected] = parsed.positionals;
            if (subcommand !== "run" || !event || unexpected.length > 0) {
              output.stderr("Usage: projj hooks run <event> [--all] [--filter <selector>] [--dry-run]\n");
              return 1;
            }
            if (event !== "post_clone") {
              output.stderr(`unsupported hook event: ${event}\n`);
              return 1;
            }

            const filter =
              typeof parsed.values.filter === "string" ? parsed.values.filter : undefined;
            const config = await loadConfig(configPath, home);
            const repos =
              parsed.values.all || filter
                ? filterReposBySelector(await scanRepos(config.base), filter)
                : currentRepoFromBaseDirs(config.base, cwd);
            if (!parsed.values.all && !filter && repos.length === 0) {
              output.stderr(
                "current directory is not a managed repository; pass --all or --filter <selector>\n",
              );
              return 1;
            }
            if (filter && repos.length === 0) {
              output.stderr(`${colors.warning(`No repositories matched: ${filter}`)}\n`);
              return 1;
            }

            const action = parsed.values["dry-run"] ? "Would run" : "Running";
            const noun = repos.length === 1 ? "repository" : "repositories";
            output.stdout(
              parsed.values.all || filter
                ? `${action} post_clone hooks in ${repos.length} ${noun}\n`
                : `${action} post_clone hooks in current directory\n`,
            );

            let exitCode = 0;
            const failures: Array<{ key: string; task: string; code: number }> = [];
            for (const repo of repos) {
              output.stdout(`${colors.repoHeader(`==> ${repo.key}`)}\n`);
              const result = await runHooks({
                event: "post_clone",
                hooks: config.hooks,
                repo: repoInfoFromScannedRepo(repo),
                repoPath: repo.path,
                globalTasks: config.tasks,
                output,
                dryRun: parsed.values["dry-run"],
                runShellCommand,
              });
              if (result.matched === 0) output.stdout("No matching hooks.\n");
              if (result.failure) {
                exitCode = result.failure.code;
                failures.push({
                  key: repo.key,
                  task: result.failure.task,
                  code: result.failure.code,
                });
              }
            }

            if (failures.length > 0) {
              const failureNoun = failures.length === 1 ? "repository" : "repositories";
              output.stderr(`${colors.failureTitle(`Failed in ${failures.length} ${failureNoun}:`)}\n`);
              for (const failure of failures) {
                output.stderr(
                  `- ${failure.key} post_clone ${failure.task} exited ${formatExitCode(failure.code, colors.exitReason)}\n`,
                );
              }
            }

            return exitCode;
          }
          case "run": {
            const separatorIndex = rest.indexOf("--");
            const commandArgs = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
            const extraArgs = separatorIndex === -1 ? [] : rest.slice(separatorIndex + 1);
            const parsed = parseArgs({
              args: commandArgs,
              options: {
                all: { type: "boolean", default: false },
                changed: { type: "boolean", default: false },
                "dry-run": { type: "boolean", default: false },
                filter: { type: "string" },
                list: { type: "boolean", default: false },
              },
              allowPositionals: true,
            });

            if (parsed.values.list) {
              if (
                parsed.positionals.length > 0 ||
                extraArgs.length > 0 ||
                parsed.values["dry-run"]
              ) {
                output.stderr("Usage: projj run --list [--all] [--filter <selector>]\n");
                return 1;
              }

              const config = await loadConfig(configPath, home);
              const filter =
                typeof parsed.values.filter === "string" ? parsed.values.filter : undefined;

              if (!parsed.values.all && !filter) {
                output.stdout(
                  formatTaskList(
                    `Tasks in ${cwd}`,
                    await listRunTasks(cwd, config.tasks, {
                      globalSource: `global (${configPath})`,
                    }),
                    {
                      heading: colors.heading,
                      source: colors.taskSource,
                    },
                  ),
                );
                return 0;
              }

              const repos = filterReposBySelector(await scanRepos(config.base), filter);
              if (filter && repos.length === 0) {
                output.stderr(`${colors.warning(`No repositories matched: ${filter}`)}\n`);
                return 1;
              }

              output.stdout(`${colors.heading(`Tasks in ${repos.length} repositories`)}\n\n`);
              let exitCode = 0;
              for (const repo of repos) {
                try {
                  output.stdout(`${colors.repoHeader(`==> ${repo.key}`)}\n`);
                  output.stdout(
                    formatTaskList(
                      "",
                      await listRunTasks(repo.path, config.tasks, {
                        globalSource: `global (${configPath})`,
                      }),
                      {
                        heading: colors.heading,
                        source: colors.taskSource,
                      },
                    ).replace(/^\n+/, ""),
                  );
                } catch (error) {
                  output.stderr(`${repo.key}: ${formatError(error)}\n`);
                  exitCode = 1;
                }
              }
              return exitCode;
            }

            const forcedRawCommand =
              parsed.positionals.length === 0 && extraArgs.length > 0
                ? extraArgs.join(" ")
                : undefined;

            if (parsed.positionals.length === 0 && !forcedRawCommand) {
              output.stderr("Usage: projj run <task> [--all] [--filter <selector>] [-- ...args]\n");
              output.stderr("Use `projj run -- git status` for raw shell commands.\n");
              return 1;
            }

            if (parsed.positionals.length > 1) {
              output.stderr("Usage: projj run <task> [--all] [--filter <selector>] [-- ...args]\n");
              output.stderr("Use `projj run -- git status` for raw shell commands.\n");
              return 1;
            }

            const [first] = parsed.positionals;
            const commandOrTask = first;
            const commandInput = forcedRawCommand ?? commandOrTask!;
            const appendedArgs = forcedRawCommand ? [] : extraArgs;
            const config =
              !forcedRawCommand && commandInput === "start"
                ? await loadConfigOrDefault(configPath, home)
                : await loadConfig(configPath, home);

            const filter =
              typeof parsed.values.filter === "string" ? parsed.values.filter : undefined;

            if (!parsed.values.all && !filter) {
              if (parsed.values.changed) {
                const status = await getRepoChangeStatus(cwd);
                if (status.kind === "clean") {
                  output.stdout("No changes in current directory.\n");
                  return 0;
                }
                if (status.kind === "error") {
                  output.stderr(
                    `current directory: git status failed with exit code ${status.exitCode}\n`,
                  );
                  return 1;
                }
              }

              if (!forcedRawCommand) {
                return runTaskLifecycle(
                  commandInput,
                  appendedArgs,
                  cwd,
                  config,
                  parsed.values["dry-run"],
                  `Would run in current directory: ${commandInput}\n`,
                );
              }

              const runCommand = await resolveRunCommand(commandInput, appendedArgs, config.tasks, cwd);
              if (parsed.values["dry-run"]) {
                output.stdout(`Would run in current directory: ${commandInput}\n`);
                output.stdout(`${colors.command(`$ ${runCommand}`)}\n`);
                return 0;
              }
              return runShellCommand(runCommand, cwd);
            }

            let exitCode = 0;
            let repos = filterReposBySelector(
              await scanRepos(config.base),
              filter,
            );
            if (filter && repos.length === 0) {
              output.stderr(`${colors.warning(`No repositories matched: ${filter}`)}\n`);
              return 1;
            }

            if (parsed.values.changed) {
              const changedRepos = [];
              for (const repo of repos) {
                const status = await getRepoChangeStatus(repo.path);
                if (status.kind === "changed") {
                  changedRepos.push(repo);
                } else if (status.kind === "error") {
                  output.stderr(`${repo.key}: git status failed with exit code ${status.exitCode}\n`);
                  exitCode = 1;
                }
              }
              repos = changedRepos;
            }

            const failures: Array<{ key: string; code: number }> = [];
            const action = parsed.values["dry-run"] ? "Would run" : "Running";
            output.stdout(`${action} in ${repos.length} repositories: ${commandInput}\n`);
            for (const repo of repos) {
              try {
                output.stdout(`${colors.repoHeader(`==> ${repo.key}`)}\n`);
                const code = forcedRawCommand
                  ? await runRawCommandInRepo(
                      commandInput,
                      appendedArgs,
                      repo,
                      config,
                      parsed.values["dry-run"],
                    )
                  : await runTaskLifecycle(
                      commandInput,
                      appendedArgs,
                      repo.path,
                      config,
                      parsed.values["dry-run"],
                      "",
                      `${repo.key}: Task not found: ${commandInput}\n`,
                      repo,
                      true,
                    );
                if (code !== 0) {
                  exitCode = code;
                  failures.push({ key: repo.key, code });
                }
              } catch (error) {
                output.stderr(`${repo.key}: ${formatError(error)}\n`);
                exitCode = 1;
              }
            }

            if (failures.length > 0) {
              const noun = failures.length === 1 ? "repository" : "repositories";
              output.stderr(`${colors.failureTitle(`Failed in ${failures.length} ${noun}:`)}\n`);
              for (const failure of failures) {
                output.stderr(
                  `- ${failure.key} exited ${formatExitCode(failure.code, colors.exitReason)}\n`,
                );
              }
            }

            return exitCode;
          }
          case "start": {
            const separatorIndex = rest.indexOf("--");
            const commandArgs = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
            const extraArgs = separatorIndex === -1 ? [] : rest.slice(separatorIndex + 1);
            const parsed = parseArgs({
              args: commandArgs,
              options: {
                "dry-run": { type: "boolean", default: false },
              },
              allowPositionals: false,
            });

            const config = await loadConfigOrDefault(configPath, home);
            return runTaskLifecycle(
              "start",
              extraArgs,
              cwd,
              config,
              parsed.values["dry-run"],
              "Would start current project\n",
              "No start command found in current directory.\n",
            );
          }
          default:
            output.stderr(`unknown command: ${command}\n`);
            return 1;
        }
      } catch (error) {
        output.stderr(`${formatError(error)}\n`);
        return 1;
      }
    },
  };
}

function isSupportedShell(value: string): value is SupportedShell {
  return value === "zsh" || value === "bash" || value === "fish";
}

function hookEventForTask(prefix: "pre" | "post", task: string): `pre_${string}` | `post_${string}` | undefined {
  return /^[A-Za-z0-9_.-]+$/.test(task) ? `${prefix}_${task}` : undefined;
}

function formatTaskNotFoundMessage(hint: TaskNotFoundHint): string {
  const lines = [`Task not found: ${hint.task}`];
  lines.push(formatTaskNotFoundHint(hint));
  return `${lines.join("\n")}\n`;
}

function formatTaskNotFoundHint(hint: TaskNotFoundHint): string {
  const displayProviders = hint.detectedProviders.filter((provider) => provider !== "global");
  const rawSuggestion = `run a raw command with \`projj run -- ${hint.task}\``;

  if (displayProviders.length === 0) {
    return `Define ${hint.task} in .projj.toml [tasks], add a supported project task file, or ${rawSuggestion}.`;
  }

  if (displayProviders.length === 1) {
    return `Detected ${formatProviderList(displayProviders)}. ${capitalize(taskProviderSuggestion(hint.task, displayProviders[0]!))} or ${rawSuggestion}.`;
  }

  return `Detected ${formatProviderList(displayProviders)}. Add ${hint.task} to the matching project task config or ${rawSuggestion}.`;
}

function taskProviderSuggestion(task: string, provider: TaskProviderKind): string {
  switch (provider) {
    case "package":
      return `add scripts.${task} to package.json`;
    case "make":
      return `add a ${task} target to Makefile`;
    case "just":
      return `add a ${task} recipe to justfile`;
    case "taskfile":
      return `add a ${task} task to Taskfile`;
    case "local":
    case "cargo":
    case "go":
    case "global":
      return `define ${task} in .projj.toml [tasks]`;
  }
}

function formatProviderList(providers: TaskProviderKind[]): string {
  return joinSentence(providers.map(providerLabel));
}

function providerLabel(provider: TaskProviderKind): string {
  switch (provider) {
    case "local":
      return ".projj.toml";
    case "package":
      return "package.json";
    case "make":
      return "Makefile";
    case "just":
      return "justfile";
    case "taskfile":
      return "Taskfile";
    case "cargo":
      return "Cargo.toml";
    case "go":
      return "go.mod";
    case "global":
      return "global config";
  }
}

function joinSentence(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

function capitalize(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expandCliPath(value: string, home: string, cwd: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  if (isAbsolute(value)) return value;
  return resolve(cwd, value);
}

function repoInfoFromScannedRepo(repo: Repo): RepoInfo {
  return {
    host: repo.host,
    owner: repo.owner,
    repo: repo.name,
    cloneUrl: `git@${repo.host}:${repo.owner}/${repo.name}.git`,
    relPath: repo.key,
  };
}

function repoInfoFromCurrentDirectory(cwd: string): RepoInfo {
  const name = basename(resolve(cwd)) || "current";
  return {
    host: "local",
    owner: "current",
    repo: name,
    cloneUrl: "",
    relPath: `local/current/${name}`,
  };
}

async function loadConfigOrDefault(configPath: string, home: string): Promise<ProjjConfig> {
  try {
    return await loadConfig(configPath, home);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      const fallback = defaultConfig();
      return {
        ...fallback,
        base: fallback.base.map((path) => expandCliPath(path, home, dirnameForConfig(configPath))),
      };
    }
    throw error;
  }
}

function dirnameForConfig(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash === -1 ? "." : path.slice(0, lastSlash);
}

function currentRepoFromBaseDirs(baseDirs: string[], cwd: string): Repo[] {
  const resolvedCwd = resolve(cwd);

  for (const baseDir of baseDirs) {
    const base = resolve(baseDir);
    const rel = relative(base, resolvedCwd);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;

    const parts = rel.split(/[\\/]+/);
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) continue;
    const [host, owner, name] = parts as [string, string, string];
    return [
      {
        base,
        host,
        owner,
        name,
        path: resolvedCwd,
        key: `${host}/${owner}/${name}`,
      },
    ];
  }

  return [];
}

function formatExitCode(
  code: number,
  formatReason: (text: string) => string = (text) => text,
): string {
  const explanation = exitCodeExplanation(code);
  return explanation ? `${code} ${formatReason(`(${explanation})`)}` : String(code);
}

function exitCodeExplanation(code: number): string | undefined {
  switch (code) {
    case 126:
      return "command found but not executable";
    case 127:
      return "command not found";
    case 130:
      return "interrupted";
    default:
      return undefined;
  }
}
