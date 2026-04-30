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
    expect(stderr.join("")).toContain("Usage: projj run <task>");
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
        "  test  vitest\n",
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

  test("run without --all executes task in cwd", async () => {
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

    const code = await cli.run(["run", "status"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "git status", cwd }]);
  });

  test("run returns 1 when task is not found", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      cwd,
    });

    const code = await cli.run(["run", "missing"]);

    expect(code).toBe(1);
    expect(stderr.join("")).toBe(
      "Task not found: missing\n" +
        "Define missing in .projj.toml [tasks], add a supported project task file, or run a raw command with `projj run -- missing`.\n",
    );
  });

  test("run task not found suggests detected package scripts or raw command", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      cwd,
    });

    const code = await cli.run(["run", "missing"]);

    expect(code).toBe(1);
    expect(stderr.join("")).toBe(
      "Task not found: missing\n" +
        "Detected package.json. Add scripts.missing to package.json or run a raw command with `projj run -- missing`.\n",
    );
  });

  test("run task not found suggests config or raw command when no providers are detected", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      cwd,
    });

    const code = await cli.run(["run", "missing"]);

    expect(code).toBe(1);
    expect(stderr.join("")).toBe(
      "Task not found: missing\n" +
        "Define missing in .projj.toml [tasks], add a supported project task file, or run a raw command with `projj run -- missing`.\n",
    );
  });

  test("run task not found suggests all detected task providers", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    await writeFile(join(cwd, "Makefile"), "test:\n\t@echo test\n");
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      cwd,
    });

    const code = await cli.run(["run", "missing"]);

    expect(code).toBe(1);
    expect(stderr.join("")).toBe(
      "Task not found: missing\n" +
        "Detected package.json or Makefile. Add missing to the matching project task config or run a raw command with `projj run -- missing`.\n",
    );
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
        "$ pnpm run test\n",
    );
  });

  test("start --dry-run prints resolved current-project command without executing", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const stdout: string[] = [];
    let calls = 0;
    await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      home,
      cwd,
      runShellCommand: async () => {
        calls += 1;
        return 0;
      },
    });

    const code = await cli.run(["start", "--dry-run", "--", "--host", "0.0.0.0"]);

    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(stdout.join("")).toBe(
      "Would start current project\n" +
        "$ pnpm run dev -- --host 0.0.0.0\n",
    );
  });

  test("start executes resolved command in current directory", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const calls: Array<{ command: string; cwd: string }> = [];
    await writeFile(join(cwd, ".projj.toml"), '[tasks]\nstart = "bun dev"\n');
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      home,
      cwd,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["start", "--", "--open"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "bun dev --open", cwd }]);
  });

  test("status --dry-run prints resolved current-project command without executing", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const stdout: string[] = [];
    let calls = 0;
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      home,
      cwd,
      runShellCommand: async () => {
        calls += 1;
        return 0;
      },
    });

    const code = await cli.run(["status", "--dry-run"]);

    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(stdout.join("")).toBe(
      "Would status current project\n" +
        "$ git status --short --branch\n",
    );
  });

  test("status executes resolved command in current directory and appends args", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const calls: Array<{ command: string; cwd: string }> = [];
    await writeFile(join(cwd, ".projj.toml"), '[tasks]\nstatus = "git status --short"\n');
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      home,
      cwd,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["status", "--", "--branch"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "git status --short --branch", cwd }]);
  });

  test("status runs built-in fallback when no explicit task is configured", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      home,
      cwd,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["status"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "git status --short --branch", cwd }]);
  });

  test("install clean and stop dry-run print resolved current-project commands", async () => {
    const home = await tempDir();

    const installCwd = await tempDir();
    await writeFile(join(installCwd, "package.json"), JSON.stringify({ scripts: {} }));
    await writeFile(join(installCwd, "pnpm-lock.yaml"), "");
    const installStdout: string[] = [];
    let installCalls = 0;
    const installCli = createCli({
      stdout: (text) => installStdout.push(text),
      stderr: () => {},
      home,
      cwd: installCwd,
      runShellCommand: async () => {
        installCalls += 1;
        return 0;
      },
    });

    const installCode = await installCli.run(["install", "--dry-run", "--", "--frozen-lockfile"]);

    expect(installCode).toBe(0);
    expect(installCalls).toBe(0);
    expect(installStdout.join("")).toBe(
      "Would install current project\n" +
        "$ pnpm install --frozen-lockfile\n",
    );

    const cleanCwd = await tempDir();
    await writeFile(join(cleanCwd, "Cargo.toml"), "[package]\nname = \"demo\"\n");
    const cleanStdout: string[] = [];
    const cleanCli = createCli({
      stdout: (text) => cleanStdout.push(text),
      stderr: () => {},
      home,
      cwd: cleanCwd,
    });

    const cleanCode = await cleanCli.run(["clean", "--dry-run"]);

    expect(cleanCode).toBe(0);
    expect(cleanStdout.join("")).toBe(
      "Would clean current project\n" +
        "$ cargo clean\n",
    );

    const stopCwd = await tempDir();
    await writeFile(join(stopCwd, "package.json"), JSON.stringify({ scripts: { stop: "vite --stop" } }));
    const stopStdout: string[] = [];
    const stopCli = createCli({
      stdout: (text) => stopStdout.push(text),
      stderr: () => {},
      home,
      cwd: stopCwd,
    });

    const stopCode = await stopCli.run(["stop", "--dry-run", "--", "--graceful"]);

    expect(stopCode).toBe(0);
    expect(stopStdout.join("")).toBe(
      "Would stop current project\n" +
        "$ pnpm run stop -- --graceful\n",
    );
  });

  test("install clean and stop execute resolved commands in current directory", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    await writeFile(
      join(cwd, ".projj.toml"),
      [
        "[tasks]",
        'install = "pnpm install"',
        'clean = "pnpm clean"',
        'stop = "pnpm stop"',
        "",
      ].join("\n"),
    );
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      home,
      cwd,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    expect(await cli.run(["install"])).toBe(0);
    expect(await cli.run(["clean"])).toBe(0);
    expect(await cli.run(["stop", "--", "--graceful"])).toBe(0);
    expect(calls).toEqual([
      { command: "pnpm install", cwd },
      { command: "pnpm clean", cwd },
      { command: "pnpm stop --graceful", cwd },
    ]);
  });

  test("install clean and stop report current-directory not found errors", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      home,
      cwd,
    });

    expect(await cli.run(["install"])).toBe(1);
    expect(await cli.run(["clean"])).toBe(1);
    expect(await cli.run(["stop"])).toBe(1);
    expect(stderr.join("")).toBe(
      "No install command found in current directory.\n" +
        "No clean command found in current directory.\n" +
        "No stop command found in current directory.\n",
    );
  });

  test("intent shortcuts reject repository selection options", async () => {
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
    });

    const filterCode = await cli.run(["install", "--filter", "atian25/*"]);
    const allCode = await cli.run(["status", "--all"]);
    const changedCode = await cli.run(["status", "--changed"]);

    expect(filterCode).toBe(1);
    expect(allCode).toBe(1);
    expect(changedCode).toBe(1);
    expect(stderr.join("")).toContain("Unknown option");
  });

  test("start runs lifecycle hooks around the resolved command", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const cwd = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        'platform = "github.com"',
        "",
        "[tasks]",
        'prepare = "echo prepare"',
        'announce = "echo started"',
        "",
        "[[hooks]]",
        'event = "pre_start"',
        'filter = "atian25/*"',
        'tasks = ["prepare"]',
        "",
        "[[hooks]]",
        'event = "post_start"',
        'filter = "github.com/atian25/*"',
        'tasks = ["announce"]',
        "",
      ].join("\n"),
    );
    await writeFile(join(cwd, ".projj.toml"), '[tasks]\nstart = "bun dev"\n');
    const calls: Array<{ command: string; cwd: string; event: string | undefined }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command, runCwd, options) => {
        calls.push({ command, cwd: runCwd, event: options?.env?.PROJJ_EVENT });
        return 0;
      },
    });

    const code = await cli.run(["start"]);

    expect(code).toBe(0);
    expect(calls).toEqual([
      { command: "echo prepare", cwd, event: "pre_start" },
      { command: "bun dev", cwd, event: undefined },
      { command: "echo started", cwd, event: "post_start" },
    ]);
  });

  test("run start uses the same built-in fallback as start", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const stdout: string[] = [];
    let calls = 0;
    await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      home,
      cwd,
      runShellCommand: async () => {
        calls += 1;
        return 0;
      },
    });

    const code = await cli.run(["run", "start", "--dry-run"]);

    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(stdout.join("")).toBe(
      "Would run in current directory: start\n" +
        "$ pnpm run dev\n",
    );
  });

  test("run start runs start lifecycle hooks", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const cwd = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        "",
        "[tasks]",
        'prepare = "echo prepare"',
        'announce = "echo started"',
        "",
        "[[hooks]]",
        'event = "pre_start"',
        'tasks = ["prepare"]',
        "",
        "[[hooks]]",
        'event = "post_start"',
        'tasks = ["announce"]',
        "",
      ].join("\n"),
    );
    await writeFile(join(cwd, ".projj.toml"), '[tasks]\nstart = "bun dev"\n');
    const calls: Array<{ command: string; event: string | undefined }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command, _runCwd, options) => {
        calls.push({ command, event: options?.env?.PROJJ_EVENT });
        return 0;
      },
    });

    const code = await cli.run(["run", "start"]);

    expect(code).toBe(0);
    expect(calls).toEqual([
      { command: "echo prepare", event: "pre_start" },
      { command: "bun dev", event: undefined },
      { command: "echo started", event: "post_start" },
    ]);
  });

  test("run task runs matching generic lifecycle hooks", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${join(home, "repos")}"]`,
        "",
        "[tasks]",
        'prepare = "echo prepare-test"',
        'announce = "echo tested"',
        "",
        "[[hooks]]",
        'event = "pre_test"',
        'tasks = ["prepare"]',
        "",
        "[[hooks]]",
        'event = "post_test"',
        'tasks = ["announce"]',
        "",
      ].join("\n"),
    );
    await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    const calls: Array<{ command: string; event: string | undefined }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command, _runCwd, options) => {
        calls.push({ command, event: options?.env?.PROJJ_EVENT });
        return 0;
      },
    });

    const code = await cli.run(["run", "test"]);

    expect(code).toBe(0);
    expect(calls).toEqual([
      { command: "echo prepare-test", event: "pre_test" },
      { command: "pnpm run test", event: undefined },
      { command: "echo tested", event: "post_test" },
    ]);
  });

  test("status shortcut runs lifecycle hooks around the resolved command", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const cwd = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        "",
        "[tasks]",
        'status = "git status --short"',
        'prepare = "echo prepare-status"',
        'announce = "echo status-done"',
        "",
        "[[hooks]]",
        'event = "pre_status"',
        'tasks = ["prepare"]',
        "",
        "[[hooks]]",
        'event = "post_status"',
        'tasks = ["announce"]',
        "",
      ].join("\n"),
    );
    const calls: Array<{ command: string; event: string | undefined }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command, _runCwd, options) => {
        calls.push({ command, event: options?.env?.PROJJ_EVENT });
        return 0;
      },
    });

    const code = await cli.run(["status"]);

    expect(code).toBe(0);
    expect(calls).toEqual([
      { command: "echo prepare-status", event: "pre_status" },
      { command: "git status --short", event: undefined },
      { command: "echo status-done", event: "post_status" },
    ]);
  });

  test("status shortcut skips main command and post hook when pre_status fails", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const cwd = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        "",
        "[tasks]",
        'status = "git status --short"',
        'prepare = "echo prepare-status"',
        'announce = "echo status-done"',
        "",
        "[[hooks]]",
        'event = "pre_status"',
        'tasks = ["prepare"]',
        "",
        "[[hooks]]",
        'event = "post_status"',
        'tasks = ["announce"]',
        "",
      ].join("\n"),
    );
    const calls: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command) => {
        calls.push(command);
        return 5;
      },
    });

    const code = await cli.run(["status"]);

    expect(code).toBe(5);
    expect(calls).toEqual(["echo prepare-status"]);
  });

  test("install shortcut runs lifecycle hooks around the resolved command", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const cwd = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        "",
        "[tasks]",
        'prepare = "echo prepare-install"',
        'announce = "echo installed"',
        "",
        "[[hooks]]",
        'event = "pre_install"',
        'tasks = ["prepare"]',
        "",
        "[[hooks]]",
        'event = "post_install"',
        'tasks = ["announce"]',
        "",
      ].join("\n"),
    );
    await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: {} }));
    await writeFile(join(cwd, "pnpm-lock.yaml"), "");
    const calls: Array<{ command: string; event: string | undefined }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command, _runCwd, options) => {
        calls.push({ command, event: options?.env?.PROJJ_EVENT });
        return 0;
      },
    });

    const code = await cli.run(["install"]);

    expect(code).toBe(0);
    expect(calls).toEqual([
      { command: "echo prepare-install", event: "pre_install" },
      { command: "pnpm install", event: undefined },
      { command: "echo installed", event: "post_install" },
    ]);
  });

  test("install shortcut skips main command and post hook when pre_install fails", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const cwd = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        "",
        "[tasks]",
        'prepare = "echo prepare-install"',
        'announce = "echo installed"',
        "",
        "[[hooks]]",
        'event = "pre_install"',
        'tasks = ["prepare"]',
        "",
        "[[hooks]]",
        'event = "post_install"',
        'tasks = ["announce"]',
        "",
      ].join("\n"),
    );
    await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: {} }));
    const calls: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command) => {
        calls.push(command);
        return 7;
      },
    });

    const code = await cli.run(["install"]);

    expect(code).toBe(7);
    expect(calls).toEqual(["echo prepare-install"]);
  });

  test("run raw command does not run lifecycle hooks", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${join(home, "repos")}"]`,
        "",
        "[tasks]",
        'prepare = "echo prepare"',
        "",
        "[[hooks]]",
        'event = "pre_echo"',
        'tasks = ["prepare"]',
        "",
      ].join("\n"),
    );
    const calls: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command) => {
        calls.push(command);
        return 0;
      },
    });

    const code = await cli.run(["run", "--", "echo ok"]);

    expect(code).toBe(0);
    expect(calls).toEqual(["echo ok"]);
  });

  test("run start with filter runs start lifecycle hooks in matching repositories", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const repoPath = await createRepo(base, "github.com", "atian25", "web");
    await createRepo(base, "github.com", "eggjs", "egg");
    await writeFile(join(repoPath, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        "",
        "[tasks]",
        'prepare = "echo prepare"',
        'announce = "echo started"',
        "",
        "[[hooks]]",
        'event = "pre_start"',
        'tasks = ["prepare"]',
        "",
        "[[hooks]]",
        'event = "post_start"',
        'tasks = ["announce"]',
        "",
      ].join("\n"),
    );
    const calls: Array<{ command: string; cwd: string; event: string | undefined }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      runShellCommand: async (command, runCwd, options) => {
        calls.push({ command, cwd: runCwd, event: options?.env?.PROJJ_EVENT });
        return 0;
      },
    });

    const code = await cli.run(["run", "start", "--filter", "atian25/*"]);

    expect(code).toBe(0);
    expect(calls).toEqual([
      { command: "echo prepare", cwd: repoPath, event: "pre_start" },
      { command: "pnpm run dev", cwd: repoPath, event: undefined },
      { command: "echo started", cwd: repoPath, event: "post_start" },
    ]);
  });

  test("start skips main command and post hook when pre_start fails", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const cwd = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        "",
        "[tasks]",
        'prepare = "echo prepare"',
        'announce = "echo started"',
        "",
        "[[hooks]]",
        'event = "pre_start"',
        'tasks = ["prepare"]',
        "",
        "[[hooks]]",
        'event = "post_start"',
        'tasks = ["announce"]',
        "",
      ].join("\n"),
    );
    await writeFile(join(cwd, ".projj.toml"), '[tasks]\nstart = "bun dev"\n');
    const calls: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command) => {
        calls.push(command);
        return 9;
      },
    });

    const code = await cli.run(["start"]);

    expect(code).toBe(9);
    expect(calls).toEqual(["echo prepare"]);
  });

  test("start skips post_start when main command fails", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const cwd = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        "",
        "[tasks]",
        'announce = "echo started"',
        "",
        "[[hooks]]",
        'event = "post_start"',
        'tasks = ["announce"]',
        "",
      ].join("\n"),
    );
    await writeFile(join(cwd, ".projj.toml"), '[tasks]\nstart = "bun dev"\n');
    const calls: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command) => {
        calls.push(command);
        return command === "bun dev" ? 8 : 0;
      },
    });

    const code = await cli.run(["start"]);

    expect(code).toBe(8);
    expect(calls).toEqual(["bun dev"]);
  });

  test("start returns post_start failure code", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const cwd = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        "",
        "[tasks]",
        'announce = "echo started"',
        "",
        "[[hooks]]",
        'event = "post_start"',
        'tasks = ["announce"]',
        "",
      ].join("\n"),
    );
    await writeFile(join(cwd, ".projj.toml"), '[tasks]\nstart = "bun dev"\n');
    const calls: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      runShellCommand: async (command) => {
        calls.push(command);
        return command === "echo started" ? 6 : 0;
      },
    });

    const code = await cli.run(["start"]);

    expect(code).toBe(6);
    expect(calls).toEqual(["bun dev", "echo started"]);
  });

  test("start returns 1 when no start command is found", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      home,
      cwd,
    });

    const code = await cli.run(["start"]);

    expect(code).toBe(1);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("No start command found in current directory.\n");
  });

  test("run --dry-run supports forced raw command", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
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

  test("run rejects extra positional args instead of treating them as raw command", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    const stderr: string[] = [];
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      cwd,
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "git", "status"]);

    expect(code).toBe(1);
    expect(stderr.join("")).toBe(
      "Usage: projj run <task> [--all] [--filter <selector>] [-- ...args]\n" +
        "Use `projj run -- git status` for raw shell commands.\n",
    );
    expect(calls).toEqual([]);
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
    await writeFile(
      configPath,
      `base = ["${base}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
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
    await writeFile(
      configPath,
      `base = ["${base}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
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

  test("run appends args after -- to task and does not treat positionals as raw command", async () => {
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
    await writeFile(
      configPath,
      `base = ["${base}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
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
    await writeFile(
      configPath,
      `base = ["${base}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
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
    await writeFile(
      configPath,
      `base = ["${base}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
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
        "$ pnpm run test\n" +
        "==> github.com/atian25/web\n" +
        "$ go test ./...\n",
    );
  });

  test("run filter supports install clean and stop intents in repositories", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const nodePath = await createRepo(base, "github.com", "atian25", "node");
    const rustPath = await createRepo(base, "github.com", "atian25", "rust");
    const servicePath = await createRepo(base, "github.com", "atian25", "service");
    await writeFile(join(nodePath, "package.json"), JSON.stringify({ scripts: {} }));
    await writeFile(join(nodePath, "pnpm-lock.yaml"), "");
    await writeFile(join(rustPath, "Cargo.toml"), "[package]\nname = \"demo\"\n");
    await writeFile(join(servicePath, "package.json"), JSON.stringify({ scripts: { stop: "vite --stop" } }));
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

    expect(await cli.run(["run", "install", "--filter", "atian25/node", "--dry-run"])).toBe(0);
    expect(await cli.run(["run", "clean", "--filter", "atian25/rust", "--dry-run"])).toBe(0);
    expect(await cli.run(["run", "stop", "--filter", "atian25/service"])).toBe(0);

    expect(stdout.join("")).toBe(
      "Would run in 1 repositories: install\n" +
        "==> github.com/atian25/node\n" +
        "$ pnpm install\n" +
        "Would run in 1 repositories: clean\n" +
        "==> github.com/atian25/rust\n" +
        "$ cargo clean\n" +
        "Running in 1 repositories: stop\n" +
        "==> github.com/atian25/service\n" +
        "$ pnpm run stop\n",
    );
    expect(calls).toEqual([{ command: "pnpm run stop", cwd: servicePath }]);
  });

  test("run --all --dry-run returns 0 with zero repositories", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${base}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
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
    expect(stdout.join("")).toContain("==> github.com/atian25/good\n$ pnpm run test\n");
    expect(stderr.join("")).toContain("github.com/atian25/bad: invalid package.json");
  });

  test("run --changed checks only current directory without --all or --filter", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      cwd,
      getRepoChangeStatus: async (repoPath) =>
        repoPath === cwd ? { kind: "changed" } : { kind: "clean" },
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "status", "--changed"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "git status --short", cwd }]);
  });

  test("run --changed skips clean current directory", async () => {
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
      getRepoChangeStatus: async () => ({ kind: "clean" }),
      runShellCommand: async () => {
        calls += 1;
        return 0;
      },
    });

    const code = await cli.run(["run", "status", "--changed"]);

    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(stdout.join("")).toBe("No changes in current directory.\n");
  });

  test("run --changed reports current directory change detection failure", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      cwd,
      getRepoChangeStatus: async () => ({ kind: "error", exitCode: 128 }),
      runShellCommand: async () => 0,
    });

    const code = await cli.run(["run", "status", "--changed"]);

    expect(code).toBe(1);
    expect(stderr.join("")).toBe("current directory: git status failed with exit code 128\n");
  });

  test("run --filter --changed uses intersection", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const changedPath = await createRepo(base, "github.com", "atian25", "changed");
    await createRepo(base, "github.com", "eggjs", "changed");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${base}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: () => {},
      configPath,
      home,
      getRepoChangeStatus: async () => ({ kind: "changed" }),
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "status", "--filter", "atian25/*", "--changed"]);

    expect(code).toBe(0);
    expect(calls).toEqual([{ command: "git status --short", cwd: changedPath }]);
  });

  test("run --changed --dry-run previews changed current directory", async () => {
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
      getRepoChangeStatus: async () => ({ kind: "changed" }),
      runShellCommand: async () => {
        calls += 1;
        return 0;
      },
    });

    const code = await cli.run(["run", "--changed", "--dry-run", "--", "ls"]);

    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(stdout.join("")).toBe(
      "Would run in current directory: ls\n" +
        "$ ls\n",
    );
  });

  test("run --all --changed returns 1 when change detection fails and continues", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const badPath = await createRepo(base, "github.com", "atian25", "bad");
    const goodPath = await createRepo(base, "github.com", "atian25", "good");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${base}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
    const stderr: string[] = [];
    const calls: Array<{ command: string; cwd: string }> = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      getRepoChangeStatus: async (repoPath) =>
        repoPath === badPath ? { kind: "error", exitCode: 128 } : { kind: "changed" },
      runShellCommand: async (command, runCwd) => {
        calls.push({ command, cwd: runCwd });
        return 0;
      },
    });

    const code = await cli.run(["run", "status", "--all", "--changed"]);

    expect(code).toBe(1);
    expect(stderr.join("")).toContain("github.com/atian25/bad: git status failed with exit code 128");
    expect(calls).toEqual([{ command: "git status --short", cwd: goodPath }]);
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
    await writeFile(
      configPath,
      `base = ["${base}"]\nplatform = "github.com"\n[tasks]\nstatus = "git status --short"\n`,
    );
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
    expect(stderr.join("")).toContain("Usage: projj clone <repo> [--base <path>] [--no-cd] [--dry-run]");
  });

  test("clone --dry-run previews clone target without cloning or cd", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const finalizerFile = join(home, "finalizer");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      `base = ["${base}"]\nplatform = "github.com"\n[[hooks]]\nevent = "post_clone"\ntasks = ["setup"]\n`,
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    let cloneCalls = 0;
    let hookCalls = 0;
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      env: { HOME: home, PROJJ_FINALIZER_FILE: finalizerFile },
      configPath,
      home,
      cloneRepo: async () => {
        cloneCalls += 1;
      },
      runShellCommand: async () => {
        hookCalls += 1;
        return 0;
      },
    });

    const code = await cli.run(["clone", "atian25/ppt-test", "--dry-run"]);
    const targetPath = join(base, "github.com", "atian25", "ppt-test");

    expect(code).toBe(0);
    expect(stdout.join("")).toBe(
      "Would clone git@github.com:atian25/ppt-test.git\n" +
        `to ${targetPath}\n`,
    );
    expect(stderr.join("")).toBe("");
    expect(cloneCalls).toBe(0);
    expect(hookCalls).toBe(0);
    await expect(readFile(finalizerFile, "utf8")).rejects.toThrow();
  });

  test("clone --dry-run previews existing target without cloning", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const repoPath = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
    const stdout: string[] = [];
    let cloneCalls = 0;
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
      cloneRepo: async () => {
        cloneCalls += 1;
      },
    });

    const code = await cli.run(["clone", "atian25/projj", "--dry-run"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toBe(`Would skip existing ${repoPath}\n`);
    expect(cloneCalls).toBe(0);
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

  test("hooks run post_clone defaults to current repository", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const repoPath = await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        'platform = "github.com"',
        "[tasks]",
        'setup = "echo setup"',
        "",
        "[[hooks]]",
        'event = "post_clone"',
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
      cwd: repoPath,
      runShellCommand: async (command, cwd, options) => {
        calls.push({ command, cwd, env: options?.env });
        return 0;
      },
    });

    const code = await cli.run(["hooks", "run", "post_clone"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("Running post_clone hooks in current directory\n");
    expect(stdout.join("")).toContain("==> github.com/atian25/projj\n");
    expect(calls).toEqual([
      {
        command: "echo setup",
        cwd: repoPath,
        env: {
          PROJJ_EVENT: "post_clone",
          PROJJ_REPO_PATH: repoPath,
          PROJJ_REPO_HOST: "github.com",
          PROJJ_REPO_OWNER: "atian25",
          PROJJ_REPO_NAME: "projj",
          PROJJ_REPO_URL: "git@github.com:atian25/projj.git",
        },
      },
    ]);
  });

  test("hooks run post_clone reports when current directory is not managed", async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      cwd,
    });

    const code = await cli.run(["hooks", "run", "post_clone"]);

    expect(code).toBe(1);
    expect(stderr.join("")).toBe(
      "current directory is not a managed repository; pass --all or --filter <selector>\n",
    );
  });

  test("hooks run requires event", async () => {
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
    });

    const code = await cli.run(["hooks", "run"]);

    expect(code).toBe(1);
    expect(stderr.join("")).toContain(
      "Usage: projj hooks run <event> [--all] [--filter <selector>] [--dry-run]",
    );
  });

  test("hooks run rejects unsupported events", async () => {
    const home = await tempDir();
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(configPath, `base = ["${join(home, "repos")}"]\nplatform = "github.com"\n`);
    const stderr: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
    });

    const code = await cli.run(["hooks", "run", "pre_run", "--all"]);

    expect(code).toBe(1);
    expect(stderr.join("")).toBe("unsupported hook event: pre_run\n");
  });

  test("hooks run post_clone runs matching hooks for filtered repositories", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    const repoPath = await createRepo(base, "github.com", "atian25", "projj");
    await createRepo(base, "github.com", "eggjs", "egg");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        'platform = "github.com"',
        "[tasks]",
        'setup = "echo setup"',
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
      runShellCommand: async (command, cwd, options) => {
        calls.push({ command, cwd, env: options?.env });
        return 0;
      },
    });

    const code = await cli.run(["hooks", "run", "post_clone", "--filter", "atian25/*"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("Running post_clone hooks in 1 repository\n");
    expect(stdout.join("")).toContain("==> github.com/atian25/projj\n");
    expect(calls).toEqual([
      {
        command: "echo setup",
        cwd: repoPath,
        env: {
          PROJJ_EVENT: "post_clone",
          PROJJ_REPO_PATH: repoPath,
          PROJJ_REPO_HOST: "github.com",
          PROJJ_REPO_OWNER: "atian25",
          PROJJ_REPO_NAME: "projj",
          PROJJ_REPO_URL: "git@github.com:atian25/projj.git",
        },
      },
    ]);
  });

  test("hooks run post_clone dry-run previews all repositories without executing", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    await createRepo(base, "github.com", "atian25", "projj");
    await createRepo(base, "github.com", "eggjs", "egg");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        'platform = "github.com"',
        "[tasks]",
        'setup = "echo setup"',
        "",
        "[[hooks]]",
        'event = "post_clone"',
        'tasks = ["setup"]',
        "",
      ].join("\n"),
    );
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

    const code = await cli.run(["hooks", "run", "post_clone", "--all", "--dry-run"]);

    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(stdout.join("")).toBe(
      "Would run post_clone hooks in 2 repositories\n" +
        "==> github.com/atian25/projj\n" +
        "hook post_clone: setup\n" +
        "$ echo setup\n" +
        "==> github.com/eggjs/egg\n" +
        "hook post_clone: setup\n" +
        "$ echo setup\n",
    );
  });

  test("hooks run post_clone reports repositories with no matching hooks", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    await createRepo(base, "github.com", "atian25", "projj");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        'platform = "github.com"',
        "[[hooks]]",
        'event = "post_clone"',
        'filter = "eggjs/*"',
        'tasks = ["setup"]',
        "",
      ].join("\n"),
    );
    const stdout: string[] = [];
    const cli = createCli({
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      configPath,
      home,
    });

    const code = await cli.run(["hooks", "run", "post_clone", "--all"]);

    expect(code).toBe(0);
    expect(stdout.join("")).toBe(
      "Running post_clone hooks in 1 repository\n" +
        "==> github.com/atian25/projj\n" +
        "No matching hooks.\n",
    );
  });

  test("hooks run post_clone summarizes hook failures and continues", async () => {
    const home = await tempDir();
    const base = join(home, "repos");
    await createRepo(base, "github.com", "atian25", "projj");
    await createRepo(base, "github.com", "eggjs", "egg");
    const configPath = join(home, ".projj", "config.toml");
    await mkdir(join(home, ".projj"), { recursive: true });
    await writeFile(
      configPath,
      [
        `base = ["${base}"]`,
        'platform = "github.com"',
        "[tasks]",
        'setup = "echo setup"',
        "",
        "[[hooks]]",
        'event = "post_clone"',
        'tasks = ["setup"]',
        "",
      ].join("\n"),
    );
    const stderr: string[] = [];
    const calls: string[] = [];
    const cli = createCli({
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      configPath,
      home,
      runShellCommand: async (_command, cwd) => {
        calls.push(cwd);
        return cwd.includes("atian25") ? 7 : 0;
      },
    });

    const code = await cli.run(["hooks", "run", "post_clone", "--all"]);

    expect(code).toBe(7);
    expect(calls).toHaveLength(2);
    expect(stderr.join("")).toContain("hook post_clone failed: setup exited 7\n");
    expect(stderr.join("")).toContain("Failed in 1 repository:\n");
    expect(stderr.join("")).toContain("- github.com/atian25/projj post_clone setup exited 7\n");
  });
});
