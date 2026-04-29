import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRunCommand } from "../src/tasks";

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
});
