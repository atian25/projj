# Post Clone Hooks 实现计划

> **给 agentic workers：** REQUIRED SUB-SKILL：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐步执行本计划。步骤使用 checkbox（`- [ ]`）语法追踪。

**目标：** 为 `projj clone` 增加第一版 `post_clone` hooks，在新仓库成功 clone 后按配置自动执行任务。

**架构：** 扩展 `src/config.ts` 加载和校验 `[[hooks]]`，新增 `src/hooks.ts` 负责 hook 匹配、上下文环境变量和任务执行。`src/cli.ts` 只在 clone 成功分支调用 hook 执行器，已存在仓库分支保持不触发。

**技术栈：** Bun、TypeScript、`smol-toml`、`bun:test`。

---

## 文件结构

- 修改：`src/config.ts`，增加 `HookConfig` 类型、默认 hooks、配置校验。
- 修改：`test/config.test.ts`，覆盖 hooks 配置解析和错误。
- 新建：`src/hooks.ts`，实现 hook 选择、环境变量、顺序执行。
- 新建：`test/hooks.test.ts`，覆盖 hook 匹配和执行语义。
- 修改：`src/run.ts`，让 shell command runner 支持额外环境变量。
- 修改：`test/run.test.ts`，覆盖额外环境变量传递。
- 修改：`src/cli.ts`，在 clone 成功后调用 `runHooks`。
- 修改：`test/cli.test.ts`，覆盖 clone 后触发、exists 不触发、失败不 finalizer。
- 修改：`README.md`，补充用户可见的 `post_clone` hooks 配置说明。

### 任务 1：配置 schema

**文件：**
- 修改：`src/config.ts`
- 修改：`test/config.test.ts`

- [ ] **步骤 1：写配置测试**

在 `test/config.test.ts` 增加：

```ts
test("default config includes empty hooks", () => {
  expect(defaultConfig().hooks).toEqual([]);
});

test("loads post_clone hooks", async () => {
  const root = await tempDir();
  const configPath = join(root, ".projj", "config.toml");
  await mkdir(dirname(configPath), { recursive: true });
  await Bun.write(
    configPath,
    [
      'base = ["~/projj"]',
      'platform = "github.com"',
      "",
      "[[hooks]]",
      'event = "post_clone"',
      'filter = "github.com/atian25/*"',
      'tasks = ["setup-git-user", "zoxide"]',
      "",
    ].join("\n"),
  );

  const config = await loadConfig(configPath, root);

  expect(config.hooks).toEqual([
    {
      event: "post_clone",
      filter: "github.com/atian25/*",
      tasks: ["setup-git-user", "zoxide"],
    },
  ]);
});

test("load config rejects invalid hooks", async () => {
  const cases: Array<{ name: string; toml: string; message: string }> = [
    {
      name: "non-array hooks",
      toml: 'hooks = "post_clone"',
      message: "invalid config: hooks must be an array",
    },
    {
      name: "unsupported event",
      toml: '[[hooks]]\nevent = "pre_clone"\ntasks = ["setup"]\n',
      message: "invalid config: hooks[0].event must be post_clone",
    },
    {
      name: "empty tasks",
      toml: '[[hooks]]\nevent = "post_clone"\ntasks = []\n',
      message: "invalid config: hooks[0].tasks must be a non-empty string[]",
    },
    {
      name: "non-string filter",
      toml: '[[hooks]]\nevent = "post_clone"\nfilter = 1\ntasks = ["setup"]\n',
      message: "invalid config: hooks[0].filter must be a string",
    },
  ];

  for (const item of cases) {
    const root = await tempDir();
    const configPath = join(root, ".projj", "config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await Bun.write(configPath, item.toml);

    await expect(loadConfig(configPath, root), item.name).rejects.toThrow(item.message);
  }
});
```

- [ ] **步骤 2：跑测试确认失败**

执行：`/Users/tz/.bun/bin/bun test test/config.test.ts`

预期：FAIL，因为 `ProjjConfig.hooks` 尚不存在。

- [ ] **步骤 3：实现配置解析**

在 `src/config.ts` 增加：

```ts
export type HookConfig = {
  event: "post_clone";
  filter?: string;
  tasks: string[];
};
```

`ProjjConfig` 增加：

```ts
hooks: HookConfig[];
```

`defaultConfig()` 增加：

```ts
hooks: [],
```

在 `normalizeParsedConfig` 中加入：

```ts
let hooks: HookConfig[] = defaults.hooks;
if (hasField(record, "hooks")) {
  if (!Array.isArray(record.hooks)) {
    throw new Error("invalid config: hooks must be an array");
  }
  hooks = record.hooks.map((hook, index) => normalizeHookConfig(hook, index));
}

return { base, platform, tasks, hooks };
```

并新增：

```ts
function normalizeHookConfig(value: unknown, index: number): HookConfig {
  if (!isRecord(value)) {
    throw new Error(`invalid config: hooks[${index}] must be an object`);
  }
  if (value.event !== "post_clone") {
    throw new Error(`invalid config: hooks[${index}].event must be post_clone`);
  }
  if (
    !Array.isArray(value.tasks) ||
    value.tasks.length === 0 ||
    !value.tasks.every((task) => typeof task === "string")
  ) {
    throw new Error(`invalid config: hooks[${index}].tasks must be a non-empty string[]`);
  }
  if (hasField(value, "filter") && typeof value.filter !== "string") {
    throw new Error(`invalid config: hooks[${index}].filter must be a string`);
  }

  return {
    event: "post_clone",
    tasks: [...value.tasks],
    ...(typeof value.filter === "string" ? { filter: value.filter } : {}),
  };
}
```

- [ ] **步骤 4：跑配置测试**

执行：`/Users/tz/.bun/bin/bun test test/config.test.ts`

预期：PASS。

### 任务 2：run 支持额外环境变量

**文件：**
- 修改：`src/run.ts`
- 修改：`test/run.test.ts`

- [ ] **步骤 1：写 runner env 测试**

在 `test/run.test.ts` 增加：

```ts
test("run shell command merges extra environment", async () => {
  const calls: Array<{ cmd: string[]; cwd: string; env?: Record<string, string> }> = [];
  const code = await runShellCommand("echo ok", "/repo", {
    env: { PROJJ_EVENT: "post_clone" },
    spawn: (cmd, options) => {
      calls.push({ cmd, cwd: options.cwd, env: options.env });
      return { exited: Promise.resolve(0) };
    },
  });

  expect(code).toBe(0);
  expect(calls).toEqual([
    {
      cmd: ["/bin/sh", "-c", "echo ok"],
      cwd: "/repo",
      env: { PROJJ_EVENT: "post_clone" },
    },
  ]);
});
```

- [ ] **步骤 2：跑测试确认失败**

执行：`/Users/tz/.bun/bin/bun test test/run.test.ts`

预期：FAIL，因为 `runShellCommand` 还不接受 options。

- [ ] **步骤 3：实现 runner options**

把 `src/run.ts` 的 `runShellCommand` 改为：

```ts
type ShellSpawn = (
  cmd: string[],
  options: { cwd: string; env?: Record<string, string>; stdin: "inherit"; stdout: "inherit"; stderr: "inherit" },
) => { exited: Promise<number> };

type RunShellCommandOptions = {
  env?: Record<string, string>;
  spawn?: ShellSpawn;
};

export async function runShellCommand(
  command: string,
  cwd: string,
  options: RunShellCommandOptions = {},
): Promise<number> {
  const spawn = options.spawn ?? Bun.spawn;
  const child = spawn(["/bin/sh", "-c", command], {
    cwd,
    env: options.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return child.exited;
}
```

保留 `resolveCommand` 和 `shellQuote` 行为不变。

- [ ] **步骤 4：跑 run 测试**

执行：`/Users/tz/.bun/bin/bun test test/run.test.ts`

预期：PASS。

### 任务 3：hook 匹配和执行器

**文件：**
- 新建：`src/hooks.ts`
- 新建：`test/hooks.test.ts`

- [ ] **步骤 1：写 hook 测试**

新建 `test/hooks.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import type { HookConfig } from "../src/config";
import type { RepoInfo } from "../src/git-url";
import { buildHookEnv, selectHooks, runHooks } from "../src/hooks";

const repo: RepoInfo = {
  host: "github.com",
  owner: "atian25",
  repo: "projj",
  cloneUrl: "git@github.com:atian25/projj.git",
};

describe("hooks", () => {
  test("selects post_clone hooks by selector", () => {
    const hooks: HookConfig[] = [
      { event: "post_clone", tasks: ["all"] },
      { event: "post_clone", filter: "projj", tasks: ["repo"] },
      { event: "post_clone", filter: "atian25/*", tasks: ["owner"] },
      { event: "post_clone", filter: "github.com/atian25/*", tasks: ["host"] },
      { event: "post_clone", filter: "eggjs/*", tasks: ["miss"] },
    ];

    expect(selectHooks(hooks, "post_clone", repo).map((hook) => hook.tasks[0])).toEqual([
      "all",
      "repo",
      "owner",
      "host",
    ]);
  });

  test("builds hook environment", () => {
    expect(buildHookEnv("post_clone", repo, "/repo")).toEqual({
      PROJJ_EVENT: "post_clone",
      PROJJ_REPO_PATH: "/repo",
      PROJJ_REPO_HOST: "github.com",
      PROJJ_REPO_OWNER: "atian25",
      PROJJ_REPO_NAME: "projj",
      PROJJ_REPO_URL: "git@github.com:atian25/projj.git",
    });
  });

  test("runs hooks in order with resolved commands and env", async () => {
    const stdout: string[] = [];
    const calls: Array<{ command: string; cwd: string; env?: Record<string, string> }> = [];

    const code = await runHooks({
      event: "post_clone",
      hooks: [
        { event: "post_clone", tasks: ["setup", "echo done"] },
        { event: "post_clone", filter: "github.com/atian25/*", tasks: ["status"] },
      ],
      repo,
      repoPath: "/repo",
      globalTasks: {
        setup: "git config user.email me@example.com",
        status: "git status --short",
      },
      output: { stdout: (text) => stdout.push(text), stderr: () => {} },
      runShellCommand: async (command, cwd, options) => {
        calls.push({ command, cwd, env: options?.env });
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("hook post_clone: setup\n");
    expect(stdout.join("")).toContain("$ git config user.email me@example.com\n");
    expect(calls.map((call) => call.command)).toEqual([
      "git config user.email me@example.com",
      "echo done",
      "git status --short",
    ]);
    expect(calls.every((call) => call.cwd === "/repo")).toBe(true);
    expect(calls[0]?.env?.PROJJ_EVENT).toBe("post_clone");
    expect(calls[0]?.env?.PROJJ_REPO_NAME).toBe("projj");
  });

  test("stops on first failing hook task", async () => {
    const stderr: string[] = [];
    const calls: string[] = [];

    const code = await runHooks({
      event: "post_clone",
      hooks: [
        { event: "post_clone", tasks: ["setup", "next"] },
        { event: "post_clone", tasks: ["later"] },
      ],
      repo,
      repoPath: "/repo",
      globalTasks: { setup: "setup command" },
      output: { stdout: () => {}, stderr: (text) => stderr.push(text) },
      runShellCommand: async (command) => {
        calls.push(command);
        return 7;
      },
    });

    expect(code).toBe(7);
    expect(calls).toEqual(["setup command"]);
    expect(stderr.join("")).toBe("hook post_clone failed: setup exited 7\n");
  });
});
```

- [ ] **步骤 2：跑测试确认失败**

执行：`/Users/tz/.bun/bin/bun test test/hooks.test.ts`

预期：FAIL，因为 `src/hooks.ts` 尚不存在。

- [ ] **步骤 3：实现 hooks 模块**

新建 `src/hooks.ts`，实现：

```ts
import type { HookConfig } from "./config";
import type { RepoInfo } from "./git-url";
import type { Output } from "./output";
import { filterReposBySelector, runShellCommand as defaultRunShellCommand } from "./run";
import { resolveRunCommand } from "./tasks";

export type HookEvent = "post_clone";

type RunHooksOptions = {
  event: HookEvent;
  hooks: HookConfig[];
  repo: RepoInfo;
  repoPath: string;
  globalTasks: Record<string, string>;
  output: Output;
  runShellCommand?: typeof defaultRunShellCommand;
};

export function selectHooks(
  hooks: HookConfig[],
  event: HookEvent,
  repo: RepoInfo,
): HookConfig[] {
  return hooks.filter((hook) => {
    if (hook.event !== event) return false;
    if (!hook.filter) return true;
    return filterReposBySelector([{ key: repoKey(repo), path: "" }], hook.filter).length > 0;
  });
}

export function buildHookEnv(
  event: HookEvent,
  repo: RepoInfo,
  repoPath: string,
): Record<string, string> {
  return {
    PROJJ_EVENT: event,
    PROJJ_REPO_PATH: repoPath,
    PROJJ_REPO_HOST: repo.host,
    PROJJ_REPO_OWNER: repo.owner,
    PROJJ_REPO_NAME: repo.repo,
    PROJJ_REPO_URL: repo.cloneUrl,
  };
}

export async function runHooks(options: RunHooksOptions): Promise<number> {
  const hooks = selectHooks(options.hooks, options.event, options.repo);
  const runShellCommand = options.runShellCommand ?? defaultRunShellCommand;
  const env = buildHookEnv(options.event, options.repo, options.repoPath);

  for (const hook of hooks) {
    for (const task of hook.tasks) {
      options.output.stdout(`hook ${options.event}: ${task}\n`);
      const command = await resolveRunCommand(task, [], options.globalTasks, options.repoPath);
      options.output.stdout(`$ ${command}\n`);
      const code = await runShellCommand(command, options.repoPath, { env });
      if (code !== 0) {
        options.output.stderr(`hook ${options.event} failed: ${task} exited ${code}\n`);
        return code;
      }
    }
  }

  return 0;
}

function repoKey(repo: RepoInfo): string {
  return `${repo.host}/${repo.owner}/${repo.repo}`;
}
```

- [ ] **步骤 4：跑 hook 测试**

执行：`/Users/tz/.bun/bin/bun test test/hooks.test.ts`

预期：PASS。

### 任务 4：CLI 接入 clone hooks

**文件：**
- 修改：`src/cli.ts`
- 修改：`test/cli.test.ts`

- [ ] **步骤 1：写 CLI 测试**

在 `test/cli.test.ts` 增加：

```ts
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
  const calls: Array<{ command: string; cwd: string; env?: Record<string, string> }> = [];
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
```

- [ ] **步骤 2：跑 CLI 测试确认失败**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：FAIL，因为 `clone` 尚未调用 hooks。

- [ ] **步骤 3：接入 `src/cli.ts`**

增加 import：

```ts
import { runHooks } from "./hooks";
```

`clone` 分支中只在新 clone 成功后运行：

```ts
let cloned = false;
if (await pathExists(targetPath)) {
  output.stdout(`exists ${targetPath}\n`);
} else {
  await cloneRepo(repo.cloneUrl, targetPath);
  cloned = true;
  output.stdout(`cloned ${targetPath}\n`);
}

if (cloned) {
  const hookCode = await runHooks({
    event: "post_clone",
    hooks: config.hooks,
    repo,
    repoPath: targetPath,
    globalTasks: config.tasks,
    output,
    runShellCommand,
  });
  if (hookCode !== 0) return hookCode;
}
```

保留后续 auto-cd 逻辑；hook 失败时提前 return，因此不写 finalizer。

- [ ] **步骤 4：跑 CLI 测试**

执行：`/Users/tz/.bun/bin/bun test test/cli.test.ts`

预期：PASS。

### 任务 5：README 和全量验证

**文件：**
- 修改：`README.md`

- [ ] **步骤 1：补 README**

在 README 配置和 clone 说明附近增加：

```md
### Post-clone hooks

`projj clone` can run tasks after a repository is cloned for the first time:

```toml
[tasks]
setup-git-user = "git config user.email me@example.com"
zoxide = "zoxide add ."

[[hooks]]
event = "post_clone"
filter = "github.com/atian25/*"
tasks = ["setup-git-user", "zoxide"]
```

Hooks only run after a new clone succeeds. If the target repository already exists, hooks are skipped. Hook tasks run in the cloned repository and use the same task resolution as `projj run`.

Hook tasks receive:

```text
PROJJ_EVENT
PROJJ_REPO_PATH
PROJJ_REPO_HOST
PROJJ_REPO_OWNER
PROJJ_REPO_NAME
PROJJ_REPO_URL
```
```

- [ ] **步骤 2：跑全量测试**

执行：`/Users/tz/.bun/bin/bun test`

预期：所有测试通过。

- [ ] **步骤 3：跑类型检查**

执行：`/Users/tz/.bun/bin/bunx tsc --noEmit`

预期：exit 0。

- [ ] **步骤 4：检查空白**

执行：`git diff --check`

预期：无输出，exit 0。

- [ ] **步骤 5：提交实现**

```bash
git add README.md src/config.ts src/run.ts src/hooks.ts src/cli.ts test/config.test.ts test/run.test.ts test/hooks.test.ts test/cli.test.ts docs/superpowers/plans/2026-04-29-post-clone-hooks-implementation.md
git commit -m "feat: add post clone hooks"
```

## 自审

- Spec 覆盖：配置 schema、selector、执行时机、task resolution、输出、失败语义、环境变量、CLI 行为和 README 都有对应任务。
- 占位扫描：没有未完成占位。
- 类型一致性：`HookConfig`、`HookEvent`、`runHooks`、`buildHookEnv`、`selectHooks` 在计划中命名一致。
