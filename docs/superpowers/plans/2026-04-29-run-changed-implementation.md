# Run Changed 实现计划

> **给 agentic workers：** REQUIRED SUB-SKILL：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐步执行本计划。步骤使用 checkbox（`- [ ]`）语法追踪。

**目标：** 为 `projj run` 增加 `--changed`，只在 git 工作区有改动的仓库中执行或 dry-run 预览命令。

**架构：** 新增 `src/changed.ts` 封装 `git status --short` 检测，`src/cli.ts` 在 repo 扫描/filter 后应用 changed 过滤。`CliDeps` 增加可注入的 `getRepoChangeStatus`，测试不用真实调用 git。

**技术栈：** Bun、TypeScript、`node:child_process`、`bun:test`。

---

## 文件结构

- 新建：`src/changed.ts`，负责 changed 状态检测。
- 新建：`test/changed.test.ts`，覆盖 changed/clean/failure。
- 修改：`src/cli.ts`，解析 `--changed`，应用 changed 过滤和失败输出。
- 修改：`test/cli.test.ts`，覆盖 changed 目标选择、filter 交集、dry-run、检测失败。
- 修改：`README.md`，补 `--changed` 用法。
- 新增：`docs/superpowers/plans/2026-04-29-run-changed-implementation.md`，记录本实现计划。

### 任务 1：changed 检测模块

**文件：**
- 新建：`src/changed.ts`
- 新建：`test/changed.test.ts`

- [ ] **步骤 1：写 changed 模块测试**

新建 `test/changed.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { getRepoChangeStatus } from "../src/changed";

describe("changed", () => {
  test("reports changed when git status has output", async () => {
    const status = await getRepoChangeStatus("/repo", {
      run: async () => ({ exitCode: 0, stdout: " M src/index.ts\n" }),
    });

    expect(status).toEqual({ kind: "changed" });
  });

  test("reports clean when git status output is empty", async () => {
    const status = await getRepoChangeStatus("/repo", {
      run: async () => ({ exitCode: 0, stdout: "" }),
    });

    expect(status).toEqual({ kind: "clean" });
  });

  test("reports failure when git status exits non-zero", async () => {
    const status = await getRepoChangeStatus("/repo", {
      run: async () => ({ exitCode: 128, stdout: "" }),
    });

    expect(status).toEqual({ kind: "error", exitCode: 128 });
  });
});
```

- [ ] **步骤 2：跑测试确认失败**

执行：`/Users/tz/.bun/bin/bun test test/changed.test.ts`

预期：FAIL，因为 `src/changed.ts` 尚不存在。

- [ ] **步骤 3：实现 changed 模块**

新建 `src/changed.ts`：

```ts
import { spawn } from "node:child_process";

export type RepoChangeStatus =
  | { kind: "changed" }
  | { kind: "clean" }
  | { kind: "error"; exitCode: number };

type GitStatusRunner = (cwd: string) => Promise<{ exitCode: number; stdout: string }>;

type GetRepoChangeStatusOptions = {
  run?: GitStatusRunner;
};

export async function getRepoChangeStatus(
  cwd: string,
  options: GetRepoChangeStatusOptions = {},
): Promise<RepoChangeStatus> {
  const result = await (options.run ?? runGitStatusShort)(cwd);
  if (result.exitCode !== 0) return { kind: "error", exitCode: result.exitCode };
  return result.stdout.trim().length > 0 ? { kind: "changed" } : { kind: "clean" };
}

async function runGitStatusShort(cwd: string): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", ["status", "--short"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => resolve({ exitCode: 1, stdout }));
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout }));
  });
}
```

- [ ] **步骤 4：跑 changed 测试**

执行：`/Users/tz/.bun/bin/bun test test/changed.test.ts`

预期：PASS。

### 任务 2：CLI changed 目标选择

**文件：**
- 修改：`src/cli.ts`
- 修改：`test/cli.test.ts`

- [ ] **步骤 1：写 CLI changed 测试**

在 `test/cli.test.ts` 增加：

```ts
test("run --changed scans all repositories without --all", async () => {
  const home = await tempDir();
  const base = join(home, "repos");
  const changedPath = await createRepo(base, "github.com", "atian25", "changed");
  await createRepo(base, "github.com", "atian25", "clean");
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
    getRepoChangeStatus: async (repoPath) =>
      repoPath === changedPath ? { kind: "changed" } : { kind: "clean" },
    runShellCommand: async (command, runCwd) => {
      calls.push({ command, cwd: runCwd });
      return 0;
    },
  });

  const code = await cli.run(["run", "status", "--changed"]);

  expect(code).toBe(0);
  expect(stdout.join("")).toBe(
    "Running in 1 repositories: status\n" +
      "==> github.com/atian25/changed\n" +
      "$ git status --short\n",
  );
  expect(calls).toEqual([{ command: "git status --short", cwd: changedPath }]);
});

test("run --filter --changed uses intersection", async () => {
  const home = await tempDir();
  const base = join(home, "repos");
  const changedPath = await createRepo(base, "github.com", "atian25", "changed");
  await createRepo(base, "github.com", "eggjs", "changed");
  const configPath = join(home, ".projj", "config.toml");
  await mkdir(join(home, ".projj"), { recursive: true });
  await writeFile(configPath, `base = ["${base}"]\nplatform = "github.com"\n`);
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
```

- [ ] **步骤 2：跑测试确认失败**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：FAIL，因为 `--changed` 和依赖注入尚未实现。

- [ ] **步骤 3：接入 CLI options**

在 `src/cli.ts` 增加 import：

```ts
import { getRepoChangeStatus as defaultGetRepoChangeStatus } from "./changed";
```

`CliDeps` 增加：

```ts
getRepoChangeStatus?: typeof defaultGetRepoChangeStatus;
```

`createCli` 初始化：

```ts
const getRepoChangeStatus = deps.getRepoChangeStatus ?? defaultGetRepoChangeStatus;
```

`parseArgs` options 增加：

```ts
changed: { type: "boolean", default: false },
```

当前目录判断从：

```ts
if (!parsed.values.all && !filter) {
```

改成：

```ts
if (!parsed.values.all && !filter && !parsed.values.changed) {
```

这样 `--changed` 单独出现会进入批量 repo 选择。

- [ ] **步骤 4：实现 changed 过滤**

在 scan/filter 之后、空 filter 检查之后加入：

```ts
let repos = filterReposBySelector(await scanRepos(config.base), filter);
if (filter && repos.length === 0) {
  ...
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
```

注意：`exitCode` 需要在 changed 过滤前定义为 `let exitCode = 0;`，并在后续 batch 执行中继续沿用。

- [ ] **步骤 5：跑 CLI changed 测试**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：PASS。

### 任务 3：changed dry-run 和检测失败

**文件：**
- 修改：`test/cli.test.ts`
- 修改：`src/cli.ts`
- 修改：`README.md`

- [ ] **步骤 1：写 dry-run 和失败测试**

在 `test/cli.test.ts` 增加：

```ts
test("run --changed --dry-run previews only changed repositories", async () => {
  const home = await tempDir();
  const base = join(home, "repos");
  const changedPath = await createRepo(base, "github.com", "atian25", "changed");
  await createRepo(base, "github.com", "atian25", "clean");
  await writeFile(join(changedPath, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
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
    getRepoChangeStatus: async (repoPath) =>
      repoPath === changedPath ? { kind: "changed" } : { kind: "clean" },
    runShellCommand: async () => {
      calls += 1;
      return 0;
    },
  });

  const code = await cli.run(["run", "test", "--changed", "--dry-run"]);

  expect(code).toBe(0);
  expect(calls).toBe(0);
  expect(stdout.join("")).toBe(
    "Would run in 1 repositories: test\n" +
      "==> github.com/atian25/changed\n" +
      "$ npm run test\n",
  );
});

test("run --changed returns 1 when change detection fails and continues", async () => {
  const home = await tempDir();
  const base = join(home, "repos");
  const badPath = await createRepo(base, "github.com", "atian25", "bad");
  const goodPath = await createRepo(base, "github.com", "atian25", "good");
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
    getRepoChangeStatus: async (repoPath) =>
      repoPath === badPath ? { kind: "error", exitCode: 128 } : { kind: "changed" },
    runShellCommand: async (command, runCwd) => {
      calls.push({ command, cwd: runCwd });
      return 0;
    },
  });

  const code = await cli.run(["run", "status", "--changed"]);

  expect(code).toBe(1);
  expect(stderr.join("")).toContain("github.com/atian25/bad: git status failed with exit code 128");
  expect(calls).toEqual([{ command: "git status --short", cwd: goodPath }]);
});
```

- [ ] **步骤 2：确认测试通过**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：PASS。

- [ ] **步骤 3：补 README**

在 `projj run` 说明里补：

```md
Use `--changed` to run only in repositories where `git status --short` is non-empty:

```sh
projj run status --changed
projj run test --filter egg --changed --dry-run
```
```

### 任务 4：全量验证和提交

**文件：**
- 所有修改文件。

- [ ] **步骤 1：跑全量测试**

执行：`/Users/tz/.bun/bin/bun test`

预期：所有测试通过。

- [ ] **步骤 2：跑类型检查**

执行：`/Users/tz/.bun/bin/bunx tsc --noEmit`

预期：exit 0。

- [ ] **步骤 3：检查空白**

执行：`git diff --check`

预期：无输出，exit 0。

- [ ] **步骤 4：提交**

```bash
git add README.md src/changed.ts src/cli.ts test/changed.test.ts test/cli.test.ts docs/superpowers/plans/2026-04-29-run-changed-implementation.md
git commit -m "feat: add run changed filter"
```

## 自审

- Spec 覆盖：changed 默认批量、filter 交集、dry-run、检测失败、README 都有任务覆盖。
- 占位扫描：没有未完成占位。
- 类型一致性：`getRepoChangeStatus`、`RepoChangeStatus`、`changed` option 命名一致。
