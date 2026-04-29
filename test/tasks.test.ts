import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatTaskList, listRunTasks, resolveRunCommand } from "../src/tasks";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "projj-tasks-"));
}

async function touch(path: string): Promise<void> {
  await writeFile(path, "");
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
