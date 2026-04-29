import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { createCli } from "../src/cli";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "projj-cli-"));
}

async function createRepo(base: string, host: string, owner: string, name: string): Promise<string> {
  const path = join(base, host, owner, name);
  await mkdir(join(path, ".git"), { recursive: true });
  return path;
}

describe("cli", () => {
  test("prints help for --help", async () => {
    const writes: string[] = [];
    const cli = createCli({
      stdout: (text) => writes.push(text),
      stderr: (text) => writes.push(text),
    });

    const code = await cli.run(["--help"]);

    expect(code).toBe(0);
    expect(writes.join("")).toContain("projj init");
    expect(writes.join("")).toContain("projj clone <repo>");
    expect(writes.join("")).toContain("projj find [query]");
  });

  test("unknown command returns 1", async () => {
    const writes: string[] = [];
    const cli = createCli({
      stdout: (text) => writes.push(text),
      stderr: (text) => writes.push(text),
    });

    const code = await cli.run(["nope"]);

    expect(code).toBe(1);
    expect(writes.join("")).toContain("unknown command: nope");
  });

  test("shell-init zsh returns wrapper", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    const code = await cli.run(["shell-init", "zsh"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("PROJJ_FINALIZER_FILE");
    expect(stderr.join("")).toBe("");
  });

  test("shell-init rejects unsupported shell", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    const code = await cli.run(["shell-init", "nope"]);

    expect(code).toBe(1);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Usage:");
  });

  test("run without command returns usage", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    const code = await cli.run(["run"]);

    expect(code).toBe(1);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Usage: projj run <command-or-task>");
  });

  test("run --list prints tasks in current cwd", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
    await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    const stdout: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
      cwd,
    });

    const code = await cli.run(["run", "--list"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toBe(
      `Tasks in ${cwd}\n\n` +
        "package.json\n" +
        "  test  vitest\n" +
        `global (${configPath})\n` +
        "  status  git status --short\n",
    );
  });

  test("run --list with --filter prints tasks for matching repositories", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const repoPath = await createRepo(base, "github.com", "atian25", "web");
    await createRepo(base, "github.com", "eggjs", "egg");
    await writeFile(join(repoPath, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
    });

    const code = await cli.run(["run", "--list", "--filter", "atian25/*"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toBe(
      "Tasks in 1 repositories\n\n" +
        "==> github.com/atian25/web\n" +
        "package.json\n" +
        "  test  vitest\n" +
        `global (${configPath})\n` +
        "  fetch   git fetch --all --prune\n" +
        "  pull    git pull --ff-only\n" +
        "  status  git status --short\n",
    );
  });

  test("run --list with --filter returns 1 when no repositories match", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      configPath,
      home,
    });

    const code = await cli.run(["run", "--list", "--filter", "nope"]);

    expect(code).toBe(1);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("No repositories matched: nope\n");
  });

  test("run --list rejects command and extra args", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    const withCommand = await cli.run(["run", "--list", "test"]);
    const withExtraArgs = await cli.run(["run", "--list", "--", "--watch"]);

    expect(withCommand).toBe(1);
    expect(withExtraArgs).toBe(1);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Usage: projj run --list");
  });

  test("run without --all executes in cwd", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "git status"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "git status", cwd }]);
  });

  test("run --dry-run prints resolved current-directory command without executing", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n[tasks]\ntest = "global test"\n`,
    );
    await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    const stdout: string[] = [];
    let calls = 0;
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async () => {
        calls += 1;
        return 0;
      },
    });

    const code = await cli.run(["run", "test", "--dry-run"]);

    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(stdout.join("")).toBe(
      "Would run in current directory: test\n" +
        "$ npm run test\n",
    );
  });

  test("run --dry-run supports forced raw command", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    let calls = 0;
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async () => {
        calls += 1;
        return 0;
      },
    });

    const code = await cli.run(["run", "--dry-run", "--", "ls", "-a"]);

    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(stdout.join("")).toBe(
      "Would run in current directory: ls -a\n" +
        "$ ls -a\n",
    );
  });

  test("run accepts raw command split across positionals", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "git", "status"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "git status", cwd }]);
  });

  test("run treats command after -- as forced raw command", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n[tasks]\ntest = "global test"\n`,
    );
    await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "--", "test", "-f", "package.json"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "test -f package.json", cwd }]);
  });

  test("run forced raw command works with --filter", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const repoPath = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "--filter", "atian25/*", "--", "ls", "-a"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toBe(
      "Running in 1 repositories: ls -a\n" +
        "==> github.com/atian25/projj\n" +
        "$ ls -a\n",
    );
    expect(calls).toEqual([{ command: "ls -a", cwd: repoPath }]);
  });

  test("run with --filter returns 1 when no repositories match", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "test", "--filter", "nope"]);

    expect(code).toBe(1);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("No repositories matched: nope\n");
    expect(calls).toEqual([]);
  });

  test("run --all returns 0 when no repositories exist", async () => {
    const home = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
    });

    const code = await cli.run(["run", "test", "--all"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toBe("Running in 0 repositories: test\n");
  });

  test("run keeps task match when appending args after --", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status"\n`,
    );
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "status", "--", "--short"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "git status --short", cwd }]);
  });

  test("run appends args after -- to raw command split across positionals", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "git", "status", "--", "--short"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "git status --short", cwd }]);
  });

  test("run resolves package script in current cwd before global task", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n[tasks]\ntest = "global test"\n`,
    );
    await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    await writeFile(join(cwd, "bun.lock"), "");
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "test", "--", "--watch"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "bun run test -- --watch", cwd }]);
  });

  test("run with --filter executes only matching repositories without --all", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const projjPath = await createRepo(base, "github.com", "atian25", "projj");
    await createRepo(base, "github.com", "eggjs", "egg");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "status", "--filter", "atian25/*"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toBe(
      "Running in 1 repositories: status\n" +
        "==> github.com/atian25/projj\n" +
        "$ git status --short\n",
    );
    expect(calls).toEqual([{ command: "git status --short", cwd: projjPath }]);
  });

  test("run with --filter resolves task independently in each repository", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const webPath = await createRepo(base, "github.com", "atian25", "web");
    const apiPath = await createRepo(base, "github.com", "atian25", "api");
    await writeFile(join(webPath, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    await writeFile(join(webPath, "pnpm-lock.yaml"), "");
    await writeFile(join(apiPath, "go.mod"), "module example.com/api\n");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "test", "--filter", "atian25/*"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toBe(
      "Running in 2 repositories: test\n" +
        "==> github.com/atian25/api\n" +
        "$ go test ./...\n" +
        "==> github.com/atian25/web\n" +
        "$ pnpm run test\n",
    );
    expect(calls).toEqual([
      { command: "go test ./...", cwd: apiPath },
      { command: "pnpm run test", cwd: webPath },
    ]);
  });

  test("run --filter --dry-run prints resolved repository commands without executing", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const apiPath = await createRepo(base, "github.com", "atian25", "api");
    const webPath = await createRepo(base, "github.com", "atian25", "web");
    await createRepo(base, "github.com", "eggjs", "egg");
    await writeFile(join(apiPath, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    await writeFile(join(webPath, "go.mod"), "module example.com/web\n");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    let calls = 0;
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
      runShellCommand: async () => {
        calls += 1;
        return 0;
      },
    });

    const code = await cli.run(["run", "test", "--filter", "atian25/*", "--dry-run"]);

    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(stdout.join("")).toBe(
      "Would run in 2 repositories: test\n" +
        "==> github.com/atian25/api\n" +
        "$ npm run test\n" +
        "==> github.com/atian25/web\n" +
        "$ go test ./...\n",
    );
  });

  test("run --all --dry-run returns 0 with zero repositories", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
    });

    const code = await cli.run(["run", "test", "--all", "--dry-run"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toBe("Would run in 0 repositories: test\n");
  });

  test("run --filter --dry-run continues after repository task resolution errors", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const badPath = await createRepo(base, "github.com", "atian25", "bad");
    const goodPath = await createRepo(base, "github.com", "atian25", "good");
    await writeFile(join(badPath, "package.json"), "{");
    await writeFile(join(goodPath, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      configPath,
      home,
    });

    const code = await cli.run(["run", "test", "--filter", "atian25/*", "--dry-run"]);

    expect(code).toBe(1);
    expect(stdout.join("")).toContain("==> github.com/atian25/good\n$ npm run test\n");
    expect(stderr.join("")).toContain("github.com/atian25/bad: invalid package.json");
  });

  test("run with multiple repositories summarizes failures and returns last non-zero code", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const aPath = await createRepo(base, "github.com", "atian25", "a");
    const bPath = await createRepo(base, "github.com", "atian25", "b");
    const cPath = await createRepo(base, "github.com", "atian25", "c");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stderr: string[] = [];
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        if (runCwd === aPath) return 2;
        if (runCwd === cPath) return 7;
        return 0;
      },
    });

    const code = await cli.run(["run", "--filter", "atian25/*", "--", "echo", "ok"]);

    expect(code).toBe(7);
    expect(calls).toEqual([
      { command: "echo ok", cwd: aPath },
      { command: "echo ok", cwd: bPath },
      { command: "echo ok", cwd: cPath },
    ]);
    expect(stderr.join("")).toBe(
      "Failed in 2 repositories:\n" +
        "- github.com/atian25/a exited 2\n" +
        "- github.com/atian25/c exited 7\n",
    );
  });

  test("run failure summary explains common exit codes", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      runShellCommand: async () => 127,
    });

    const code = await cli.run(["run", "--filter", "atian25/*", "--", "ll"]);

    expect(code).toBe(127);
    expect(stderr.join("")).toBe(
      "Failed in 1 repository:\n" +
        "- github.com/atian25/projj exited 127 (command not found)\n",
    );
  });

  test("run batch output colorizes structured stdout when enabled", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const repoPath = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
      color: true,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "--filter", "atian25/*", "--", "ls", "-a"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "ls -a", cwd: repoPath }]);
    expect(stdout.join("")).toContain("\x1b[");
    expect(stdout.join("")).toContain("==> github.com/atian25/projj");
    expect(stdout.join("")).toContain("$ ls -a");
  });

  test("run failure summary colorizes title and exit explanation when enabled", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      color: true,
      runShellCommand: async () => 127,
    });

    const code = await cli.run(["run", "--filter", "atian25/*", "--", "ll"]);

    expect(code).toBe(127);
    expect(stderr.join("")).toContain("\x1b[");
    expect(stderr.join("")).toContain("Failed in 1 repository:");
    expect(stderr.join("")).toContain("127");
    expect(stderr.join("")).toContain("(command not found)");
  });

  test("run --all with --filter behaves like --filter", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const projjPath = await createRepo(base, "github.com", "atian25", "projj");
    await createRepo(base, "github.com", "eggjs", "egg");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "status", "--all", "--filter", "atian25/*"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "git status --short", cwd: projjPath }]);
  });

  test("run appends args after -- to configured task", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status"\n`,
    );
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "status", "--", "--short", "it's ok"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "git status --short 'it'\\''s ok'", cwd }]);
  });

  test("find --list prints matching repo paths without finalizer", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const repoPath = await createRepo(base, "github.com", "atian25", "projj");
    await createRepo(base, "github.com", "eggjs", "egg");
    const configPath = join(home, ".projj", "config.toml");
    const finalizerFile = join(home, "finalizer");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      env: { HOME: home, PROJJ_FINALIZER_FILE: finalizerFile },
      configPath,
      home,
    });

    const code = await cli.run(["find", "--list", "projj"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toBe(`${repoPath}\n`);
    expect(stderr.join("")).toBe("");
    await expect(Bun.file(finalizerFile).exists()).resolves.toBe(false);
  });

  test("find without shell integration explains how to enable auto-cd", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const repoPath = await createRepo(base, "github.com", "eggjs", "egg-view");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      env: { HOME: home },
      configPath,
      home,
    });

    const code = await cli.run(["find", "egg-view"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toBe(`${repoPath}\n`);
    expect(stderr.join("")).toContain("Auto-cd is not enabled");
    expect(stderr.join("")).toContain('echo \'eval "$(projj shell-init zsh)"\' >> ~/.zshrc && source ~/.zshrc');
  });

  test("clone without repo returns usage", async () => {
    const home = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      configPath,
      home,
    });

    const code = await cli.run(["clone"]);

    expect(code).toBe(1);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Usage: projj clone <repo> [--base <path>] [--no-cd]");
  });

  test("clone prints exists and skips clone when target exists", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const repoPath = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    let cloneCalls = 0;
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      cloneRepo: async () => {
        cloneCalls += 1;
      },
    });

    const code = await cli.run(["clone", "atian25/projj", "--no-cd"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toBe(`exists ${repoPath}\n`);
    expect(stderr.join("")).toBe("");
    expect(cloneCalls).toBe(0);
  });

  test("--base overrides default clone base", async () => {
    const home = await tempDir();
    const defaultBase = join(home, "default");
    const overrideBase = join(home, "override");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${defaultBase}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cloneTargets: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      cloneRepo: async (_cloneUrl, targetPath) => {
        cloneTargets.push(targetPath);
      },
    });

    const code = await cli.run(["clone", "atian25/projj", "--base", overrideBase, "--no-cd"]);

    expect(code).toBe(0);
    expect(cloneTargets).toEqual([join(overrideBase, "github.com", "atian25", "projj")]);
    expect(stdout.join("")).toBe(`cloned ${cloneTargets[0]}\n`);
    expect(stderr.join("")).toBe("");
  });

  test("--base relative path resolves from cwd", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "default")}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cloneTargets: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      cwd,
      cloneRepo: async (_cloneUrl, targetPath) => {
        cloneTargets.push(targetPath);
      },
    });

    const code = await cli.run(["clone", "atian25/projj", "--base", "repos", "--no-cd"]);
    const targetPath = join(cwd, "repos", "github.com", "atian25", "projj");

    expect(code).toBe(0);
    expect(cloneTargets).toEqual([targetPath]);
    expect(stdout.join("")).toBe(`cloned ${targetPath}\n`);
    expect(stderr.join("")).toBe("");
  });

  test("clone writes finalizer file by default", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const configPath = join(home, ".projj", "config.toml");
    const finalizerFile = join(home, "finalizer");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      env: { HOME: home, PROJJ_FINALIZER_FILE: finalizerFile },
      configPath,
      home,
      cloneRepo: async () => {},
    });

    const code = await cli.run(["clone", "atian25/projj"]);
    const targetPath = join(base, "github.com", "atian25", "projj");

    expect(code).toBe(0);
    expect(await readFile(finalizerFile, "utf8")).toBe(`cd:${targetPath}\n`);
    expect(stdout.join("")).toBe(`cloned ${targetPath}\n`);
    expect(stderr.join("")).toBe("");
  });

  test("clone runs matching post_clone hooks after new clone", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        'platform = "github.com"',
        "[tasks]",
        'setup = "git config user.email me@example.com"',
        "",
        "[[hooks]]",
        'event = "post_clone"',
        'filter = "github.com/atian25/*"',
        'tasks = ["setup"]',
        "",
      ].join("\n"),
    );
    const stdout: string[] = [];
    const calls: Array<{ command: string; cwd: string; env: Record<string, string> | undefined }> = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
      cloneRepo: async () => {},
      runShellCommand: async (command, cwd, options) => {
        calls.push({ command, cwd, env: options?.env });
        return 0;
      },
    });

    const code = await cli.run(["clone", "atian25/projj", "--no-cd"]);

    const targetPath = join(base, "github.com", "atian25", "projj");
    expect(code).toBe(0);
    expect(stdout.join("")).toContain(`cloned ${targetPath}\n`);
    expect(stdout.join("")).toContain("hook post_clone: setup\n");
    expect(calls).toEqual([
      {
        command: "git config user.email me@example.com",
        cwd: targetPath,
        env: {
          PROJJ_EVENT: "post_clone",
          PROJJ_REPO_PATH: targetPath,
          PROJJ_REPO_HOST: "github.com",
          PROJJ_REPO_OWNER: "atian25",
          PROJJ_REPO_NAME: "projj",
          PROJJ_REPO_URL: "git@github.com:atian25/projj.git",
        },
      },
    ]);
  });

  test("clone does not run post_clone hooks when target already exists", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${base}"]\nplatform = "github.com"\n[[hooks]]\nevent = "post_clone"\ntasks = ["setup"]\n`,
    );
    let hookCalls = 0;
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      runShellCommand: async () => {
        hookCalls += 1;
        return 0;
      },
    });

    const code = await cli.run(["clone", "atian25/projj", "--no-cd"]);

    expect(code).toBe(0);
    expect(hookCalls).toBe(0);
  });

  test("clone returns hook failure and skips finalizer", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const finalizer = join(home, "finalizer");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${base}"]\nplatform = "github.com"\n[[hooks]]\nevent = "post_clone"\ntasks = ["setup"]\n`,
    );
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      env: { HOME: home, PROJJ_FINALIZER_FILE: finalizer },
      cloneRepo: async () => {},
      runShellCommand: async () => 7,
    });

    const code = await cli.run(["clone", "atian25/projj"]);

    expect(code).toBe(7);
    expect(stderr.join("")).toContain("hook post_clone failed: setup exited 7");
    await expect(readFile(finalizer, "utf8")).rejects.toThrow();
  });

  test("clone without shell integration explains how to enable auto-cd", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      env: { HOME: home },
      configPath,
      home,
      cloneRepo: async () => {},
    });

    const code = await cli.run(["clone", "atian25/projj"]);
    const targetPath = join(base, "github.com", "atian25", "projj");

    expect(code).toBe(0);
    expect(stdout.join("")).toBe(`cloned ${targetPath}\n${targetPath}\n`);
    expect(stderr.join("")).toContain("Auto-cd is not enabled");
    expect(stderr.join("")).toContain('echo \'eval "$(projj shell-init zsh)"\' >> ~/.zshrc && source ~/.zshrc');
  });
});
