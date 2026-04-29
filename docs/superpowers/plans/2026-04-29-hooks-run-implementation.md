# Hooks Run 实现计划

> **给 agentic workers：** REQUIRED SUB-SKILL：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐步执行本计划。步骤使用 checkbox（`- [ ]`）语法追踪。

**目标：** 新增 `projj hooks run post_clone`，允许用户对已存在仓库手动补跑或 dry-run 预览已配置的 `post_clone` hooks。

**架构：** 扩展 `src/hooks.ts`，让 hook 执行器支持 dry-run、返回失败详情、暴露匹配 hooks 数量。`src/cli.ts` 新增 `hooks run` 子命令，负责扫描仓库、过滤目标、构造 repo context、逐仓库调用 hook 执行器并汇总失败。

**技术栈：** Bun、TypeScript、`node:util parseArgs`、`bun:test`。

---

## 文件结构

- 修改：`src/hooks.ts`，为 `runHooks` 增加 `dryRun` 和结构化结果。
- 修改：`test/hooks.test.ts`，覆盖 dry-run 不执行、无匹配 hooks。
- 修改：`src/cli.ts`，增加 `projj hooks run post_clone`。
- 修改：`test/cli.test.ts`，覆盖 usage、unknown event、filter/all、dry-run、失败摘要。
- 修改：`README.md`，补 `hooks run` 用户说明。
- 新增：`docs/superpowers/plans/2026-04-29-hooks-run-implementation.md`。

### 任务 1：增强 hooks 执行器

**文件：**
- 修改：`src/hooks.ts`
- 修改：`test/hooks.test.ts`

- [x] **步骤 1：写 hooks 执行器测试**

在 `test/hooks.test.ts` 增加：

```ts
test("runHooks dry-run prints resolved hook tasks without executing", async () => {
  const stdout: string[] = [];
  let calls = 0;

  const result = await runHooks({
    event: "post_clone",
    hooks: [{ event: "post_clone", tasks: ["setup"] }],
    repo,
    repoPath: "/repo",
    globalTasks: { setup: "setup command" },
    output: { stdout: (text) => stdout.push(text), stderr: () => {} },
    dryRun: true,
    runShellCommand: async () => {
      calls += 1;
      return 0;
    },
  });

  expect(result).toEqual({ code: 0, matched: 1 });
  expect(calls).toBe(0);
  expect(stdout.join("")).toBe("hook post_clone: setup\n$ setup command\n");
});

test("runHooks reports no matching hooks", async () => {
  const result = await runHooks({
    event: "post_clone",
    hooks: [{ event: "post_clone", filter: "eggjs/*", tasks: ["setup"] }],
    repo,
    repoPath: "/repo",
    globalTasks: { setup: "setup command" },
    output: { stdout: () => {}, stderr: () => {} },
  });

  expect(result).toEqual({ code: 0, matched: 0 });
});

test("runHooks returns failure details", async () => {
  const result = await runHooks({
    event: "post_clone",
    hooks: [{ event: "post_clone", tasks: ["setup"] }],
    repo,
    repoPath: "/repo",
    globalTasks: { setup: "setup command" },
    output: { stdout: () => {}, stderr: () => {} },
    runShellCommand: async () => 7,
  });

  expect(result).toEqual({
    code: 7,
    matched: 1,
    failure: { event: "post_clone", task: "setup", code: 7 },
  });
});
```

- [x] **步骤 2：跑测试确认失败**

执行：`/Users/tz/.bun/bin/bun test test/hooks.test.ts`

预期：FAIL，因为 `runHooks` 仍返回 number。

- [x] **步骤 3：实现 hooks 结构化结果**

在 `src/hooks.ts` 中新增：

```ts
export type HookRunResult = {
  code: number;
  matched: number;
  failure?: { event: HookEvent; task: string; code: number };
};
```

`RunHooksOptions` 增加：

```ts
dryRun?: boolean;
```

`runHooks` 返回 `Promise<HookRunResult>`：

```ts
const hooks = selectHooks(...);
...
if (code !== 0) {
  ...
  return {
    code,
    matched: hooks.length,
    failure: { event: options.event, task, code },
  };
}
...
return { code: 0, matched: hooks.length };
```

dry-run 时打印 hook 和命令，但跳过 `runShellCommand`。

- [x] **步骤 4：修正 clone 调用**

`src/cli.ts` 里 clone 分支原来判断 number：

```ts
const hookCode = await runHooks(...);
if (hookCode !== 0) return hookCode;
```

改成：

```ts
const hookResult = await runHooks(...);
if (hookResult.code !== 0) return hookResult.code;
```

- [x] **步骤 5：跑 hooks 和 CLI 测试**

执行：`/Users/tz/.bun/bin/bun test test/hooks.test.ts test/cli.test.ts`

预期：PASS。

### 任务 2：CLI hooks run 基础行为

**文件：**
- 修改：`src/cli.ts`
- 修改：`test/cli.test.ts`

- [x] **步骤 1：写当前目录、usage 和 unknown event 测试**

在 `test/cli.test.ts` 增加：

```ts
test("hooks run post_clone defaults to current repository", async () => {
  // 无 --all/--filter 时使用当前 managed repo。
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
```

- [x] **步骤 2：写 filter 执行测试**

在 `test/cli.test.ts` 增加：

```ts
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
  const calls: Array<{ command: string; cwd: string; env?: Record<string, string> }> = [];
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
```

- [x] **步骤 3：跑测试确认失败**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：FAIL，因为 `hooks` 子命令尚不存在。

- [x] **步骤 4：实现 `hooks run` 解析**

`HELP` 增加：

```text
projj hooks run <event> [--all] [--filter <selector>] [--dry-run]
```

`switch` 增加 `case "hooks"`：

- 只支持 positionals 第一段是 `run`。
- 用 `parseArgs` 解析 `all/filter/dry-run`。
- event 必须是 `post_clone`。
- 无 `--all` 或 `--filter` 时，使用当前目录对应的 managed repo。
- 当前目录不在任一 `base/host/owner/repo` 下时，提示用户传 `--all` 或 `--filter`。
- 加载 config、扫描 repos、应用 filter。
- filter 空匹配沿用 `No repositories matched: ...`。

Repo 转 RepoInfo helper：

```ts
function repoInfoFromRepo(repo: Repo): RepoInfo {
  return {
    host: repo.host,
    owner: repo.owner,
    repo: repo.name,
    cloneUrl: `git@${repo.host}:${repo.owner}/${repo.name}.git`,
    relPath: repo.key,
  };
}
```

- [x] **步骤 5：执行 hooks**

对目标 repos 输出 header：

```ts
const action = parsed.values["dry-run"] ? "Would run" : "Running";
const noun = repos.length === 1 ? "repository" : "repositories";
output.stdout(`${action} ${event} hooks in ${repos.length} ${noun}\n`);
```

每个 repo：

```ts
output.stdout(`${colors.repoHeader(`==> ${repo.key}`)}\n`);
const result = await runHooks({
  event,
  hooks: config.hooks,
  repo: repoInfoFromRepo(repo),
  repoPath: repo.path,
  globalTasks: config.tasks,
  output,
  runShellCommand,
  dryRun: parsed.values["dry-run"],
});
if (result.matched === 0) output.stdout("No matching hooks.\n");
...
```

- [x] **步骤 6：跑 CLI hooks run 测试**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：PASS。

### 任务 3：dry-run、all、失败摘要和 README

**文件：**
- 修改：`test/cli.test.ts`
- 修改：`src/cli.ts`
- 修改：`README.md`

- [x] **步骤 1：写 dry-run 和 all 测试**

在 `test/cli.test.ts` 增加：

```ts
test("hooks run post_clone --dry-run does not execute", async () => {
  const home = await tempDir();
  const base = join(home, "repos");
  await createRepo(base, "github.com", "atian25", "projj");
  const configPath = join(home, ".projj", "config.toml");
  await mkdir(join(home, ".projj"), { recursive: true });
  await writeFile(
    configPath,
    `base = ["${base}"]\nplatform = "github.com"\n[tasks]\nsetup = "echo setup"\n[[hooks]]\nevent = "post_clone"\ntasks = ["setup"]\n`,
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
  expect(stdout.join("")).toContain("Would run post_clone hooks in 1 repository\n");
  expect(stdout.join("")).toContain("hook post_clone: setup\n$ echo setup\n");
});

test("hooks run post_clone prints no matching hooks", async () => {
  const home = await tempDir();
  const base = join(home, "repos");
  await createRepo(base, "github.com", "atian25", "projj");
  const configPath = join(home, ".projj", "config.toml");
  await mkdir(join(home, ".projj"), { recursive: true });
  await writeFile(
    configPath,
    `base = ["${base}"]\nplatform = "github.com"\n[[hooks]]\nevent = "post_clone"\nfilter = "eggjs/*"\ntasks = ["setup"]\n`,
  );
  const stdout: string[] = [];
  const cli = createCli({
    stdout: (text) => stdout.push(text),
    stderr: () => {},
    configPath,
    home,
  });

  const code = await cli.run(["hooks", "run", "post_clone", "--all", "--dry-run"]);

  expect(code).toBe(0);
  expect(stdout.join("")).toContain("No matching hooks.\n");
});
```

- [x] **步骤 2：写失败摘要测试**

在 `test/cli.test.ts` 增加：

```ts
test("hooks run post_clone summarizes failures and continues", async () => {
  const home = await tempDir();
  const base = join(home, "repos");
  const aPath = await createRepo(base, "github.com", "atian25", "a");
  const bPath = await createRepo(base, "github.com", "atian25", "b");
  const configPath = join(home, ".projj", "config.toml");
  await mkdir(join(home, ".projj"), { recursive: true });
  await writeFile(
    configPath,
    `base = ["${base}"]\nplatform = "github.com"\n[tasks]\nsetup = "echo setup"\n[[hooks]]\nevent = "post_clone"\ntasks = ["setup"]\n`,
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
      return cwd === aPath ? 7 : 0;
    },
  });

  const code = await cli.run(["hooks", "run", "post_clone", "--all"]);

  expect(code).toBe(7);
  expect(calls).toEqual([aPath, bPath]);
  expect(stderr.join("")).toContain("Failed in 1 repository:\n");
  expect(stderr.join("")).toContain("- github.com/atian25/a post_clone setup exited 7\n");
});
```

- [x] **步骤 3：实现失败摘要**

在 `hooks run` CLI 中收集：

```ts
const failures: Array<{ key: string; event: string; task: string; code: number }> = [];
```

`result.failure` 存在时 push，`exitCode = result.failure.code`。

最后输出：

```ts
if (failures.length > 0) {
  const noun = failures.length === 1 ? "repository" : "repositories";
  output.stderr(`${colors.failureTitle(`Failed in ${failures.length} ${noun}:`)}\n`);
  for (const failure of failures) {
    output.stderr(`- ${failure.key} ${failure.event} ${failure.task} exited ${formatExitCode(failure.code, colors.exitReason)}\n`);
  }
}
```

- [x] **步骤 4：补 README**

增加用户文档：

```md
### `projj hooks run <event> [--all] [--filter <selector>] [--dry-run]`

Run configured hooks manually. The first supported event is `post_clone`:

```sh
projj hooks run post_clone --filter atian25/projj --dry-run
projj hooks run post_clone --all
```

Use this to apply clone setup hooks to repositories that already exist. Without `--all` or `--filter`, hooks run in the current managed repository.
```

- [x] **步骤 5：跑 CLI 测试**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：PASS。

### 任务 4：全量验证和提交

**文件：**
- 所有修改文件。

- [x] **步骤 1：跑全量测试**

执行：`/Users/tz/.bun/bin/bun test`

预期：所有测试通过。

- [x] **步骤 2：跑类型检查**

执行：`/Users/tz/.bun/bin/bunx tsc --noEmit`

预期：exit 0。

- [x] **步骤 3：检查空白**

执行：`git diff --check`

预期：无输出，exit 0。

- [ ] **步骤 4：提交**

```bash
git add README.md src/hooks.ts src/cli.ts test/hooks.test.ts test/cli.test.ts docs/superpowers/plans/2026-04-29-hooks-run-implementation.md
git commit -m "feat: add hooks run command"
```

## 自审

- Spec 覆盖：usage、unknown event、filter/all、dry-run、no matching hooks、失败摘要、README 都有任务覆盖。
- 占位扫描：没有未完成占位。
- 类型一致性：`HookRunResult`、`dryRun`、`failure` 字段和 CLI 摘要命名一致。
