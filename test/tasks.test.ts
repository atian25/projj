import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatTaskList,
  listRunTasks,
  resolveRunCommand,
  resolveStartCommand,
  resolveTaskCommand,
} from "../src/tasks";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "projj-tasks-"));
}

async function touch(path: string): Promise<void> {
  await writeFile(path, "");
}

async function withPath<T>(path: string, callback: () => Promise<T>): Promise<T> {
  const previous = process.env.PATH;
  process.env.PATH = path;
  try {
    return await callback();
  } finally {
    process.env.PATH = previous;
  }
}

async function fakeExecutable(dir: string, name: string): Promise<void> {
  const path = join(dir, name);
  await writeFile(path, "#!/bin/sh\n");
  await chmod(path, 0o755);
}

describe("tasks", () => {
  test("local .projj.toml task takes precedence over package and global tasks", async () => {
    const cwd = await tempDir();
    await writeFile(cwd + "/.projj.toml", '[tasks]\ntest = "bun test"\n');
    await writeFile(cwd + "/package.json", JSON.stringify({ scripts: { test: "vitest" } }));

    await expect(resolveRunCommand("test", [], { test: "global test" }, cwd)).resolves.toBe(
      "bun test",
    );
  });

  test("package script takes precedence over global task", async () => {
    const cwd = await tempDir();
    await writeFile(cwd + "/package.json", JSON.stringify({ scripts: { dev: "vite" } }));
    await touch(cwd + "/pnpm-lock.yaml");

    await expect(resolveRunCommand("dev", [], { dev: "global dev" }, cwd)).resolves.toBe(
      "pnpm run dev",
    );
  });

  test("global task takes precedence over raw command", async () => {
    const cwd = await tempDir();

    await expect(
      resolveRunCommand("status", [], { status: "git status --short" }, cwd),
    ).resolves.toBe("git status --short");
  });

  test("global explicit task takes precedence over language intent fallback", async () => {
    const cwd = await tempDir();
    await writeFile(cwd + "/Cargo.toml", "[package]\nname = \"demo\"\n");

    await expect(resolveRunCommand("test", [], { test: "cargo nextest run" }, cwd)).resolves.toBe(
      "cargo nextest run",
    );
  });

  test("falls back to raw command when no task matches", async () => {
    const cwd = await tempDir();

    await expect(resolveRunCommand("git status", [], {}, cwd)).resolves.toBe("git status");
  });

  test("appends args to local, package, global, and raw commands", async () => {
    const localCwd = await tempDir();
    await writeFile(localCwd + "/.projj.toml", '[tasks]\ntest = "bun test"\n');
    await expect(resolveRunCommand("test", ["--watch"], {}, localCwd)).resolves.toBe(
      "bun test --watch",
    );

    const packageCwd = await tempDir();
    await writeFile(packageCwd + "/package.json", JSON.stringify({ scripts: { test: "vitest" } }));
    await touch(packageCwd + "/package-lock.json");
    await expect(resolveRunCommand("test", ["it's ok"], {}, packageCwd)).resolves.toBe(
      "npm run test -- 'it'\\''s ok'",
    );

    const globalCwd = await tempDir();
    await expect(resolveRunCommand("test", ["--short"], { test: "git status" }, globalCwd))
      .resolves.toBe("git status --short");

    const rawCwd = await tempDir();
    await expect(resolveRunCommand("git status", ["--short"], {}, rawCwd)).resolves.toBe(
      "git status --short",
    );
  });

  test("detects common project task files", async () => {
    const makeCwd = await tempDir();
    await writeFile(makeCwd + "/Makefile", "test:\n\t@echo test\n");
    await expect(resolveRunCommand("test", [], {}, makeCwd)).resolves.toBe("make test");

    const justCwd = await tempDir();
    await writeFile(justCwd + "/justfile", "test:\n  echo test\n");
    await expect(resolveRunCommand("test", [], {}, justCwd)).resolves.toBe("just test");

    const taskCwd = await tempDir();
    await writeFile(taskCwd + "/Taskfile.yml", "tasks:\n  test:\n    cmds:\n      - echo test\n");
    await expect(resolveRunCommand("test", [], {}, taskCwd)).resolves.toBe("task test");

    const cargoCwd = await tempDir();
    await writeFile(cargoCwd + "/Cargo.toml", "[package]\nname = \"demo\"\n");
    await expect(resolveRunCommand("test", [], {}, cargoCwd)).resolves.toBe("cargo test");

    const goCwd = await tempDir();
    await writeFile(goCwd + "/go.mod", "module example.com/demo\n");
    await expect(resolveRunCommand("test", [], {}, goCwd)).resolves.toBe("go test ./...");
  });

  test("detects package managers from lockfiles", async () => {
    const cases = [
      ["bun.lock", "bun run test"],
      ["bun.lockb", "bun run test"],
      ["pnpm-lock.yaml", "pnpm run test"],
      ["yarn.lock", "yarn run test"],
      ["package-lock.json", "npm run test"],
    ] as const;

    for (const [lockfile, command] of cases) {
      const cwd = await tempDir();
      await writeFile(cwd + "/package.json", JSON.stringify({ scripts: { test: "vitest" } }));
      await touch(cwd + "/" + lockfile);

      await expect(resolveRunCommand("test", [], {}, cwd)).resolves.toBe(command);
    }
  });

  test("detects package manager field before lockfiles", async () => {
    const cwd = await tempDir();
    await writeFile(
      cwd + "/package.json",
      JSON.stringify({ packageManager: "bun@1.3.12", scripts: { test: "bun test" } }),
    );
    await touch(cwd + "/pnpm-lock.yaml");

    await expect(resolveRunCommand("test", [], {}, cwd)).resolves.toBe("bun run test");
  });

  test("uses available package manager preference when package has no manager signal", async () => {
    const bin = await tempDir();
    await fakeExecutable(bin, "bun");
    await fakeExecutable(bin, "npm");

    await withPath(bin, async () => {
      const cwd = await tempDir();
      await writeFile(cwd + "/package.json", JSON.stringify({ scripts: { test: "vitest" } }));

      await expect(resolveRunCommand("test", [], {}, cwd)).resolves.toBe("bun run test");
    });
  });

  test("falls back to pnpm when package has no manager signal and no manager command is available", async () => {
    await withPath("", async () => {
      const cwd = await tempDir();
      await writeFile(cwd + "/package.json", JSON.stringify({ scripts: { test: "vitest" } }));

      await expect(resolveRunCommand("test", [], {}, cwd)).resolves.toBe("pnpm run test");
    });
  });

  test("resolves install intent from package manager lockfiles", async () => {
    const cases = [
      ["bun.lock", "bun install"],
      ["bun.lockb", "bun install"],
      ["pnpm-lock.yaml", "pnpm install"],
      ["yarn.lock", "yarn install"],
      ["package-lock.json", "npm install"],
    ] as const;

    for (const [lockfile, command] of cases) {
      const cwd = await tempDir();
      await writeFile(cwd + "/package.json", JSON.stringify({ scripts: {} }));
      await touch(cwd + "/" + lockfile);

      await expect(resolveTaskCommand("install", [], {}, cwd)).resolves.toBe(command);
    }
  });

  test("install intent skips package scripts.install", async () => {
    const cwd = await tempDir();
    await writeFile(cwd + "/package.json", JSON.stringify({ scripts: { install: "node-gyp rebuild" } }));
    await touch(cwd + "/pnpm-lock.yaml");

    await expect(resolveTaskCommand("install", [], {}, cwd)).resolves.toBe("pnpm install");
  });

  test("resolves explicit install tasks before package install fallback", async () => {
    const localCwd = await tempDir();
    await writeFile(localCwd + "/.projj.toml", '[tasks]\ninstall = "corepack pnpm install"\n');
    await writeFile(localCwd + "/package.json", JSON.stringify({ scripts: {} }));
    await expect(resolveTaskCommand("install", [], {}, localCwd)).resolves.toBe(
      "corepack pnpm install",
    );

    const makeCwd = await tempDir();
    await writeFile(makeCwd + "/Makefile", "install:\n\t@echo install\n");
    await writeFile(makeCwd + "/package.json", JSON.stringify({ scripts: {} }));
    await expect(resolveTaskCommand("install", [], {}, makeCwd)).resolves.toBe("make install");

    const justCwd = await tempDir();
    await writeFile(justCwd + "/justfile", "install:\n  echo install\n");
    await writeFile(justCwd + "/package.json", JSON.stringify({ scripts: {} }));
    await expect(resolveTaskCommand("install", [], {}, justCwd)).resolves.toBe("just install");

    const taskCwd = await tempDir();
    await writeFile(taskCwd + "/Taskfile.yml", "tasks:\n  install:\n    cmds:\n      - echo install\n");
    await writeFile(taskCwd + "/package.json", JSON.stringify({ scripts: {} }));
    await expect(resolveTaskCommand("install", [], {}, taskCwd)).resolves.toBe("task install");

    const globalCwd = await tempDir();
    await writeFile(globalCwd + "/package.json", JSON.stringify({ scripts: {} }));
    await expect(resolveTaskCommand("install", [], { install: "mise install" }, globalCwd))
      .resolves.toBe("mise install");
  });

  test("does not infer install intent for cargo or go projects", async () => {
    const cargoCwd = await tempDir();
    await writeFile(cargoCwd + "/Cargo.toml", "[package]\nname = \"demo\"\n");
    await expect(resolveTaskCommand("install", [], {}, cargoCwd)).resolves.toBeUndefined();

    const goCwd = await tempDir();
    await writeFile(goCwd + "/go.mod", "module example.com/demo\n");
    await expect(resolveTaskCommand("install", [], {}, goCwd)).resolves.toBeUndefined();
  });

  test("resolves clean intent from explicit tasks and cargo fallback", async () => {
    const packageCwd = await tempDir();
    await writeFile(packageCwd + "/package.json", JSON.stringify({ scripts: { clean: "rimraf dist" } }));
    await touch(packageCwd + "/package-lock.json");
    await expect(resolveTaskCommand("clean", [], {}, packageCwd)).resolves.toBe("npm run clean");

    const makeCwd = await tempDir();
    await writeFile(makeCwd + "/Makefile", "clean:\n\t@echo clean\n");
    await expect(resolveTaskCommand("clean", [], {}, makeCwd)).resolves.toBe("make clean");

    const justCwd = await tempDir();
    await writeFile(justCwd + "/justfile", "clean:\n  echo clean\n");
    await expect(resolveTaskCommand("clean", [], {}, justCwd)).resolves.toBe("just clean");

    const taskCwd = await tempDir();
    await writeFile(taskCwd + "/Taskfile.yml", "tasks:\n  clean:\n    cmds:\n      - echo clean\n");
    await expect(resolveTaskCommand("clean", [], {}, taskCwd)).resolves.toBe("task clean");

    const cargoCwd = await tempDir();
    await writeFile(cargoCwd + "/Cargo.toml", "[package]\nname = \"demo\"\n");
    await expect(resolveTaskCommand("clean", [], {}, cargoCwd)).resolves.toBe("cargo clean");
  });

  test("does not infer clean intent from node or go projects without explicit clean task", async () => {
    const packageCwd = await tempDir();
    await writeFile(packageCwd + "/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
    await expect(resolveTaskCommand("clean", [], {}, packageCwd)).resolves.toBeUndefined();

    const goCwd = await tempDir();
    await writeFile(goCwd + "/go.mod", "module example.com/demo\n");
    await expect(resolveTaskCommand("clean", [], {}, goCwd)).resolves.toBeUndefined();
  });

  test("stop intent only resolves explicit tasks", async () => {
    const packageCwd = await tempDir();
    await writeFile(packageCwd + "/package.json", JSON.stringify({ scripts: { stop: "vite --stop" } }));
    await touch(packageCwd + "/package-lock.json");
    await expect(resolveTaskCommand("stop", [], {}, packageCwd)).resolves.toBe("npm run stop");

    const cargoCwd = await tempDir();
    await writeFile(cargoCwd + "/Cargo.toml", "[package]\nname = \"demo\"\n");
    await expect(resolveTaskCommand("stop", [], {}, cargoCwd)).resolves.toBeUndefined();

    const goCwd = await tempDir();
    await writeFile(goCwd + "/go.mod", "module example.com/demo\n");
    await expect(resolveTaskCommand("stop", [], {}, goCwd)).resolves.toBeUndefined();
  });

  test("resolves start command from local task before package scripts", async () => {
    const cwd = await tempDir();
    await writeFile(cwd + "/.projj.toml", '[tasks]\nstart = "pnpm dev"\n');
    await writeFile(cwd + "/package.json", JSON.stringify({ scripts: { dev: "vite" } }));

    await expect(resolveStartCommand([], cwd)).resolves.toBe("pnpm dev");
  });

  test("resolves package start candidates in priority order", async () => {
    const devCwd = await tempDir();
    await writeFile(
      devCwd + "/package.json",
      JSON.stringify({ scripts: { start: "vite --host", dev: "vite" } }),
    );
    await touch(devCwd + "/pnpm-lock.yaml");
    await expect(resolveStartCommand(["--host", "0.0.0.0"], devCwd)).resolves.toBe(
      "pnpm run start -- --host 0.0.0.0",
    );

    const startCwd = await tempDir();
    await writeFile(startCwd + "/package.json", JSON.stringify({ scripts: { start: "node ." } }));
    await touch(startCwd + "/package-lock.json");
    await expect(resolveStartCommand([], startCwd)).resolves.toBe("npm run start");

    const serveCwd = await tempDir();
    await writeFile(serveCwd + "/package.json", JSON.stringify({ scripts: { serve: "vite" } }));
    await touch(serveCwd + "/package-lock.json");
    await expect(resolveStartCommand([], serveCwd)).resolves.toBe("npm run serve");
  });

  test("resolves task runner and language start fallbacks", async () => {
    const makeCwd = await tempDir();
    await writeFile(makeCwd + "/Makefile", "serve:\n\t@echo serve\n");
    await expect(resolveStartCommand([], makeCwd)).resolves.toBe("make serve");

    const justCwd = await tempDir();
    await writeFile(justCwd + "/justfile", "run:\n  echo run\n");
    await expect(resolveStartCommand([], justCwd)).resolves.toBe("just run");

    const taskCwd = await tempDir();
    await writeFile(taskCwd + "/Taskfile.yml", "tasks:\n  dev:\n    cmds:\n      - echo dev\n");
    await expect(resolveStartCommand([], taskCwd)).resolves.toBe("task dev");

    const cargoCwd = await tempDir();
    await writeFile(cargoCwd + "/Cargo.toml", "[package]\nname = \"demo\"\n");
    await expect(resolveStartCommand([], cargoCwd)).resolves.toBe("cargo run");

    const goCwd = await tempDir();
    await writeFile(goCwd + "/go.mod", "module example.com/demo\n");
    await expect(resolveStartCommand([], goCwd)).resolves.toBe("go run .");
  });

  test("returns undefined when no start command is found", async () => {
    const cwd = await tempDir();

    await expect(resolveStartCommand([], cwd)).resolves.toBeUndefined();
  });

  test("rejects invalid local task files", async () => {
    const tomlCwd = await tempDir();
    await writeFile(tomlCwd + "/.projj.toml", "[tasks]\ntest = 1\n");
    await expect(resolveRunCommand("test", [], {}, tomlCwd)).rejects.toThrow(
      "invalid local task config",
    );

    const jsonCwd = await tempDir();
    await writeFile(jsonCwd + "/package.json", "{");
    await expect(resolveRunCommand("test", [], {}, jsonCwd)).rejects.toThrow(
      "invalid package.json",
    );

    const taskfileCwd = await tempDir();
    await mkdir(join(taskfileCwd, "nested"));
    await writeFile(taskfileCwd + "/Taskfile.yml", "tasks:\n  [\n");
    await expect(resolveRunCommand("test", [], {}, taskfileCwd)).rejects.toThrow(
      "invalid Taskfile",
    );
  });

  test("lists tasks grouped by source", async () => {
    const cwd = await tempDir();
    await writeFile(cwd + "/.projj.toml", '[tasks]\nlocal = "echo local"\n');
    await writeFile(
      cwd + "/package.json",
      JSON.stringify({ scripts: { test: "vitest", lint: "eslint ." } }),
    );
    await writeFile(cwd + "/Makefile", "build:\n\t@echo build\n");

    await expect(listRunTasks(cwd, { status: "git status --short" })).resolves.toEqual([
      { source: ".projj.toml", tasks: [{ name: "local", command: "echo local" }] },
      {
        source: "package.json",
        tasks: [
          { name: "lint", command: "eslint ." },
          { name: "test", command: "vitest" },
        ],
      },
      { source: "detected", tasks: [{ name: "make:build", command: "make build" }] },
      { source: "global", tasks: [{ name: "status", command: "git status --short" }] },
    ]);
  });

  test("lists common detected tasks", async () => {
    const justCwd = await tempDir();
    await writeFile(justCwd + "/justfile", "test:\n  echo test\n");
    await expect(listRunTasks(justCwd, {})).resolves.toEqual([
      { source: "detected", tasks: [{ name: "just:test", command: "just test" }] },
    ]);

    const taskCwd = await tempDir();
    await writeFile(taskCwd + "/Taskfile.yml", "tasks:\n  test:\n    cmds:\n      - echo test\n");
    await expect(listRunTasks(taskCwd, {})).resolves.toEqual([
      { source: "detected", tasks: [{ name: "task:test", command: "task test" }] },
    ]);

    const cargoCwd = await tempDir();
    await writeFile(cargoCwd + "/Cargo.toml", "[package]\nname = \"demo\"\n");
    const cargoGroups = await listRunTasks(cargoCwd, {});
    expect(cargoGroups[0]?.tasks).toContainEqual({ name: "cargo:test", command: "cargo test" });

    const goCwd = await tempDir();
    await writeFile(goCwd + "/go.mod", "module example.com/demo\n");
    const goGroups = await listRunTasks(goCwd, {});
    expect(goGroups[0]?.tasks).toContainEqual({ name: "go:test", command: "go test ./..." });
  });

  test("formats task lists", () => {
    expect(
      formatTaskList("Tasks in /repo", [
        {
          source: "package.json",
          tasks: [
            { name: "lint", command: "eslint ." },
            { name: "test-local", command: "egg-bin test" },
          ],
        },
      ]),
    ).toBe(
      "Tasks in /repo\n\n" +
        "package.json\n" +
        "  lint        eslint .\n" +
        "  test-local  egg-bin test\n",
    );

    expect(formatTaskList("Tasks in /repo", [])).toBe(
      "Tasks in /repo\n\nNo tasks found.\n",
    );
  });
});
