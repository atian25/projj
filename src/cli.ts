import { parseArgs } from "node:util";
import { isAbsolute, join, resolve } from "node:path";
import { defaultConfigPath, loadConfig, saveDefaultConfig } from "./config";
import {
  cloneRepo as defaultCloneRepo,
  pathExists as defaultPathExists,
  targetPathForRepo,
} from "./git";
import { parseRepoInput } from "./git-url";
import type { Output } from "./output";
import { formatError } from "./output";
import { findRepos, scanRepos } from "./repos";
import {
  filterReposByMatch,
  resolveCommand,
  runShellCommand as defaultRunShellCommand,
} from "./run";
import { selectRepo } from "./select";
import { shellInit, writeCdFinalizer } from "./shell";
import type { SupportedShell } from "./shell";

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
};

const HELP = `projj

Usage:
  projj init
  projj clone <repo> [--base <path>] [--no-cd]
  projj find [query] [--list]
  projj run <command-or-task> [--all] [--match <regex>] [-- ...args]
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
                "no-cd": { type: "boolean", default: false },
              },
              allowPositionals: true,
            });

            if (parsed.positionals.length !== 1) {
              output.stderr("Usage: projj clone <repo> [--base <path>] [--no-cd]\n");
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

            if (await pathExists(targetPath)) {
              output.stdout(`exists ${targetPath}\n`);
            } else {
              await cloneRepo(repo.cloneUrl, targetPath);
              output.stdout(`cloned ${targetPath}\n`);
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
          case "run": {
            const separatorIndex = rest.indexOf("--");
            const commandArgs = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
            const extraArgs = separatorIndex === -1 ? [] : rest.slice(separatorIndex + 1);
            const parsed = parseArgs({
              args: commandArgs,
              options: {
                all: { type: "boolean", default: false },
                match: { type: "string" },
              },
              allowPositionals: true,
            });

            if (parsed.positionals.length === 0) {
              output.stderr("Usage: projj run <command-or-task> [--all] [--match <regex>] [-- ...args]\n");
              return 1;
            }

            const config = await loadConfig(configPath, home);
            const [first, ...remaining] = parsed.positionals;
            const commandOrTask = first!;
            const isTask = Object.prototype.hasOwnProperty.call(config.tasks, commandOrTask);
            const appendedArgs = isTask ? [...remaining, ...extraArgs] : extraArgs;
            const runCommand = resolveCommand(
              isTask ? commandOrTask : [commandOrTask, ...remaining].join(" "),
              appendedArgs,
              config.tasks,
            );

            if (!parsed.values.all) {
              return runShellCommand(runCommand, cwd);
            }

            const repos = filterReposByMatch(
              await scanRepos(config.base),
              typeof parsed.values.match === "string" ? parsed.values.match : undefined,
            );
            let exitCode = 0;
            output.stdout(`Running in ${repos.length} repositories: ${runCommand}\n`);
            for (const repo of repos) {
              output.stdout(`==> ${repo.key}\n`);
              output.stdout(`$ ${runCommand}\n`);
              const code = await runShellCommand(runCommand, repo.path);
              if (code !== 0) exitCode = code;
            }

            return exitCode;
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

function expandCliPath(value: string, home: string, cwd: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  if (isAbsolute(value)) return value;
  return resolve(cwd, value);
}
