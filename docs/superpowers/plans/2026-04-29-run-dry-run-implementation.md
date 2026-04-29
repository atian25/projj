# Run Dry Run 实现计划

> **给 agentic workers：** REQUIRED SUB-SKILL：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐步执行本计划。步骤使用 checkbox（`- [ ]`）语法追踪。

**目标：** 为 `projj run` 增加 `--dry-run`，展示当前目录或目标仓库中最终会执行的命令，但不真正运行 shell command。

**架构：** 只改 `src/cli.ts` 的 run 分支，复用现有参数解析、repo 扫描、filter、task resolution 和颜色输出。测试集中放在 `test/cli.test.ts`，README 补用户可见示例。

**技术栈：** Bun、TypeScript、`node:util parseArgs`、`bun:test`。

---

## 文件结构

- 修改：`src/cli.ts`，为 `run` 增加 `dry-run` option 和输出分支。
- 修改：`test/cli.test.ts`，覆盖当前目录 dry-run、批量 dry-run、raw command、空匹配、解析错误。
- 修改：`README.md`，补 `--dry-run` 用法。
- 新增：`docs/superpowers/plans/2026-04-29-run-dry-run-implementation.md`，记录本实现计划。

### 任务 1：CLI dry-run 行为

**文件：**
- 修改：`test/cli.test.ts`
- 修改：`src/cli.ts`

- [ ] **步骤 1：写当前目录和 raw command dry-run 测试**

在 `test/cli.test.ts` 的 run 测试附近增加：

```ts
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
```

- [ ] **步骤 2：跑测试确认失败**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：FAIL，因为 `--dry-run` 尚未注册。

- [ ] **步骤 3：实现当前目录 dry-run**

在 `src/cli.ts` 的 `parseArgs` options 中增加：

```ts
"dry-run": { type: "boolean", default: false },
```

在 `run --list` 分支前或分支内明确拒绝：

```ts
if (parsed.values.list && parsed.values["dry-run"]) {
  output.stderr("Usage: projj run --list [--all] [--filter <selector>]\n");
  return 1;
}
```

在当前目录执行前增加：

```ts
if (!parsed.values.all && !filter) {
  const runCommand = await resolveRunCommand(commandInput, appendedArgs, config.tasks, cwd);
  if (parsed.values["dry-run"]) {
    output.stdout(`Would run in current directory: ${commandInput}\n`);
    output.stdout(`${colors.command(`$ ${runCommand}`)}\n`);
    return 0;
  }
  return runShellCommand(runCommand, cwd);
}
```

- [ ] **步骤 4：跑当前目录 dry-run 测试**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：新增当前目录 dry-run 测试通过，尚未覆盖批量 dry-run。

### 任务 2：批量 dry-run

**文件：**
- 修改：`test/cli.test.ts`
- 修改：`src/cli.ts`

- [ ] **步骤 1：写批量 dry-run 测试**

在 `test/cli.test.ts` 增加：

```ts
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
```

- [ ] **步骤 2：跑测试确认失败**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：FAIL，因为批量分支仍会执行 runner。

- [ ] **步骤 3：实现批量 dry-run**

在批量分支中，把 header 改成按 dry-run 分流：

```ts
const action = parsed.values["dry-run"] ? "Would run" : "Running";
output.stdout(`${action} in ${repos.length} repositories: ${commandInput}\n`);
```

在循环中解析命令后：

```ts
output.stdout(`${colors.repoHeader(`==> ${repo.key}`)}\n`);
output.stdout(`${colors.command(`$ ${runCommand}`)}\n`);
if (parsed.values["dry-run"]) continue;
const code = await runShellCommand(runCommand, repo.path);
```

- [ ] **步骤 4：跑批量 dry-run 测试**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：PASS。

### 任务 3：解析错误和文档

**文件：**
- 修改：`test/cli.test.ts`
- 修改：`src/cli.ts`
- 修改：`README.md`

- [ ] **步骤 1：写 dry-run 解析错误测试**

在 `test/cli.test.ts` 增加：

```ts
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
```

- [ ] **步骤 2：实现解析错误继续处理**

把批量循环中的 `resolveRunCommand` 包进 `try/catch`：

```ts
try {
  const runCommand = await resolveRunCommand(...);
  ...
} catch (error) {
  output.stderr(`${repo.key}: ${formatError(error)}\n`);
  exitCode = 1;
}
```

非 dry-run 批量执行也可受益于这个行为，但不改变已成功仓库的执行。

- [ ] **步骤 3：补 README**

在 `projj run` 示例中加入：

```md
Use `--dry-run` to preview resolved commands without executing them:

```sh
projj run test --dry-run
projj run test --filter egg --dry-run
```
```

- [ ] **步骤 4：跑相关测试**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：PASS。

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
git add README.md src/cli.ts test/cli.test.ts docs/superpowers/plans/2026-04-29-run-dry-run-implementation.md
git commit -m "feat: add run dry-run"
```

## 自审

- Spec 覆盖：当前目录、批量、raw command、空匹配、解析错误、README 都有任务覆盖。
- 占位扫描：没有未完成占位。
- 类型一致性：只新增 `dry-run` option，不引入额外模块或新类型。
