# CLI 彩色结构化输出实现计划

> **给 agentic workers：** REQUIRED SUB-SKILL：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐步执行本计划。步骤使用 checkbox（`- [ ]`）语法追踪。

**目标：** 让 `projj` 自己生成的结构化 CLI 提示支持颜色，同时保持被执行命令的原始输出不变。

**架构：** 新增 `src/color.ts` 作为唯一颜色策略入口，`src/cli.ts` 使用语义化颜色函数格式化结构化提示。`src/tasks.ts` 的任务列表格式化函数支持可选 formatter，默认仍输出纯文本。

**技术栈：** Bun、TypeScript、`node:util styleText`、`bun:test`。

---

## 文件结构

- 创建：`src/color.ts`，负责颜色启用判断和语义化主题函数。
- 创建：`test/color.test.ts`，覆盖颜色启用策略和 ANSI 输出。
- 修改：`src/cli.ts`，接入颜色主题，格式化结构化 stdout/stderr。
- 修改：`src/tasks.ts`，给 `formatTaskList` 增加可选标题/来源 formatter。
- 修改：`test/cli.test.ts`，新增彩色结构化输出测试，保持既有纯文本测试不变。

### 任务 1：颜色封装

**文件：**
- 创建：`src/color.ts`
- 测试：`test/color.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from "bun:test";
import { createColorTheme, shouldUseColor } from "../src/color";

describe("color", () => {
  test("theme returns plain text when disabled", () => {
    const colors = createColorTheme(false);

    expect(colors.repoHeader("==> repo")).toBe("==> repo");
    expect(colors.failureTitle("Failed")).toBe("Failed");
  });

  test("theme applies ansi styles when enabled", () => {
    const colors = createColorTheme(true);

    expect(colors.repoHeader("==> repo")).toContain("\x1b[");
    expect(colors.failureTitle("Failed")).toContain("\x1b[");
    expect(colors.exitReason("(command not found)")).toContain("\x1b[");
  });

  test("NO_COLOR disables color", () => {
    expect(shouldUseColor({ NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(false);
  });

  test("FORCE_COLOR enables color without tty", () => {
    expect(shouldUseColor({ FORCE_COLOR: "1" }, false)).toBe(true);
  });

  test("tty enables color by default", () => {
    expect(shouldUseColor({}, true)).toBe(true);
    expect(shouldUseColor({}, false)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

执行：`bun test test/color.test.ts`

预期：FAIL，因为 `src/color.ts` 尚不存在。

- [ ] **Step 3: 实现最小颜色封装**

```ts
import { styleText } from "node:util";

type Style = Parameters<typeof styleText>[0];

export type ColorTheme = {
  heading: (text: string) => string;
  repoHeader: (text: string) => string;
  command: (text: string) => string;
  failureTitle: (text: string) => string;
  warning: (text: string) => string;
  exitReason: (text: string) => string;
  taskSource: (text: string) => string;
};

export function shouldUseColor(
  env: Record<string, string | undefined>,
  isTty: boolean | undefined,
): boolean {
  if (env.NO_COLOR !== undefined) return false;
  if (env.NODE_DISABLE_COLORS !== undefined) return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0";
  return Boolean(isTty);
}

export function createColorTheme(enabled: boolean): ColorTheme {
  const apply = (style: Style, text: string) => (enabled ? styleText(style, text) : text);

  return {
    heading: (text) => apply("bold", text),
    repoHeader: (text) => apply(["cyan", "bold"], text),
    command: (text) => apply("dim", text),
    failureTitle: (text) => apply(["red", "bold"], text),
    warning: (text) => apply("yellow", text),
    exitReason: (text) => apply("yellow", text),
    taskSource: (text) => apply("bold", text),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

执行：`bun test test/color.test.ts`

预期：PASS。

### 任务 2：任务列表 formatter

**文件：**
- 修改：`src/tasks.ts`
- 测试：`test/cli.test.ts` 里现有任务列表期望。

- [ ] **Step 1: 写格式化能力**

把 `formatTaskList` 签名改成：

```ts
type TaskListFormatOptions = {
  heading?: (text: string) => string;
  source?: (text: string) => string;
};

export function formatTaskList(
  title: string,
  groups: TaskListGroup[],
  options: TaskListFormatOptions = {},
): string {
  const lines = [title ? (options.heading?.(title) ?? title) : title, ""];
  if (groups.length === 0) {
    lines.push("No tasks found.");
    return `${lines.join("\n")}\n`;
  }

  for (const group of groups) {
    lines.push(options.source?.(group.source) ?? group.source);
    const width = Math.max(...group.tasks.map((task) => task.name.length));
    for (const task of group.tasks) {
      lines.push(`  ${task.name.padEnd(width)}  ${task.command}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 2: 跑现有列表测试**

执行：`bun test test/cli.test.ts`

预期：PASS，默认 options 为空时输出不变。

### 任务 3：CLI 接入颜色

**文件：**
- 修改：`src/cli.ts`
- 修改：`test/cli.test.ts`

- [ ] **Step 1: 写 CLI 彩色输出测试**

在 `test/cli.test.ts` 增加两个测试：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

执行：`bun test test/cli.test.ts`

预期：FAIL，因为 `CliDeps.color` 和颜色接入尚未实现。

- [ ] **Step 3: 修改 `src/cli.ts`**

关键改动：

```ts
import { createColorTheme, shouldUseColor } from "./color";
```

`CliDeps` 增加：

```ts
color?: boolean;
```

`createCli` 初始化：

```ts
const colors = createColorTheme(
  deps.color ?? shouldUseColor(env, process.stdout.isTTY),
);
```

结构化输出改为：

```ts
output.stderr(`${colors.warning(`No repositories matched: ${filter}`)}\n`);
output.stdout(`${colors.heading(`Tasks in ${repos.length} repositories`)}\n\n`);
output.stdout(`${colors.repoHeader(`==> ${repo.key}`)}\n`);
output.stdout(`${colors.command(`$ ${runCommand}`)}\n`);
output.stderr(`${colors.failureTitle(`Failed in ${failures.length} ${noun}:`)}\n`);
output.stderr(`- ${failure.key} exited ${formatExitCode(failure.code, colors.exitReason)}\n`);
```

`formatExitCode` 改成：

```ts
function formatExitCode(code: number, formatReason: (text: string) => string = (text) => text): string {
  const explanation = exitCodeExplanation(code);
  return explanation ? `${code} ${formatReason(`(${explanation})`)}` : String(code);
}
```

`formatTaskList` 调用传入：

```ts
{
  heading: colors.heading,
  source: colors.taskSource,
}
```

- [ ] **Step 4: 跑 CLI 测试确认通过**

执行：`bun test test/cli.test.ts`

预期：PASS。

### 任务 4：全量验证和提交

**文件：**
- 所有被修改的文件。

- [ ] **Step 1: 跑全量测试**

执行：`bun test`

预期：所有测试通过。

- [ ] **Step 2: 跑类型检查**

执行：`bunx tsc --noEmit`

预期：exit 0。

- [ ] **Step 3: 检查 diff 空白**

执行：`git diff --check`

预期：无输出，exit 0。

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-04-29-cli-color-output-design.md \
  docs/superpowers/plans/2026-04-29-cli-color-output-implementation.md \
  src/color.ts \
  src/cli.ts \
  src/tasks.ts \
  test/color.test.ts \
  test/cli.test.ts
git commit -m "feat: colorize structured cli output"
```

## 自审

- Spec 覆盖：颜色来源、作用范围、环境变量、测试策略都对应到任务。
- 占位扫描：没有 TBD/TODO/“稍后实现”。
- 类型一致性：`CliDeps.color`、`createColorTheme`、`shouldUseColor`、`formatTaskList` options 在计划中命名一致。
