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
