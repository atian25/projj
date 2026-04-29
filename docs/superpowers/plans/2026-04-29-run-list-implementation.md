# run --list 实现计划

> **给执行 Agent 的要求：** 实现本计划时，必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。按任务逐项执行，使用复选框（`- [x]`）跟踪进度。

**目标：** 为 `projj run` 增加 `--list`，列出当前目录或匹配 repo 的可执行任务，不执行命令。

**架构：** 扩展 `src/tasks.ts`，在已有任务解析来源基础上增加任务收集 API 和人类可读格式化函数。`src/cli.ts` 解析 `--list`，根据当前目录、`--filter` 或 `--all` 选择目标目录并输出任务列表。

**技术栈：** Bun test、TypeScript、`smol-toml`、Node `fs/promises` 和 `path`。不新增运行时依赖。

---

### 任务 1：任务列表收集核心

**文件：**
- 修改：`src/tasks.ts`
- 修改：`test/tasks.test.ts`

- [x] **步骤 1：写失败测试**

添加测试覆盖 `listRunTasks(cwd, globalTasks)`：

```text
.projj.toml       -> source ".projj.toml"
package.json      -> source "package.json"
Makefile          -> source "detected"
global tasks      -> source "global"
```

同一来源内按任务名排序，package scripts 显示原始 script 内容。

- [x] **步骤 2：运行测试确认 RED**

运行：

```sh
/Users/tz/.bun/bin/bun test test/tasks.test.ts
```

预期：失败，因为 `listRunTasks` 不存在。

- [x] **步骤 3：实现收集 API**

在 `src/tasks.ts` 导出：

```ts
export type TaskListGroup = {
  source: string;
  tasks: Array<{ name: string; command: string }>;
};

export async function listRunTasks(
  cwd: string,
  globalTasks: Record<string, string>,
): Promise<TaskListGroup[]>;
```

复用已有解析逻辑中的文件读取和保守解析规则。

- [x] **步骤 4：运行测试确认 GREEN**

运行：

```sh
/Users/tz/.bun/bin/bun test test/tasks.test.ts
```

预期：全部通过。

### 任务 2：格式化输出

**文件：**
- 修改：`src/tasks.ts`
- 修改：`test/tasks.test.ts`

- [x] **步骤 1：写失败测试**

添加测试覆盖 `formatTaskList(path, groups)`，输出：

```text
Tasks in /repo

package.json
  test  vitest
```

任务名列使用简单 padding 对齐。

- [x] **步骤 2：实现格式化函数**

在 `src/tasks.ts` 导出：

```ts
export function formatTaskList(title: string, groups: TaskListGroup[]): string;
```

没有任务时输出：

```text
Tasks in /repo

No tasks found.
```

- [x] **步骤 3：运行测试确认 GREEN**

运行：

```sh
/Users/tz/.bun/bin/bun test test/tasks.test.ts
```

预期：全部通过。

### 任务 3：接入 CLI

**文件：**
- 修改：`src/cli.ts`
- 修改：`test/cli.test.ts`

- [x] **步骤 1：写失败测试**

添加测试覆盖：

```text
projj run --list
projj run --list --filter egg-view
projj run --list test
```

前两者输出任务列表；第三个返回 usage 错误。

- [x] **步骤 2：运行测试确认 RED**

运行：

```sh
/Users/tz/.bun/bin/bun test test/cli.test.ts
```

预期：失败，因为 CLI 未解析 `--list`。

- [x] **步骤 3：实现 CLI 分支**

在 `run` 命令解析 options 增加 `list`：

```text
list: boolean
```

规则：

- `--list` 不允许 positionals。
- `--list` 不允许 `--` 后参数。
- 无 `--filter`/`--all` 时列当前 cwd。
- 有 `--filter`/`--all` 时列匹配 repo。

- [x] **步骤 4：运行测试确认 GREEN**

运行：

```sh
/Users/tz/.bun/bin/bun test test/cli.test.ts test/tasks.test.ts
```

预期：全部通过。

### 任务 4：文档和验证

**文件：**
- 修改：`README.md`
- 修改：`docs/superpowers/specs/2026-04-29-run-list-design.md`

- [x] **步骤 1：更新 README**

在 `projj run` 小节补充：

```sh
projj run --list
projj run --list --filter egg-view
```

- [x] **步骤 2：完整验证**

运行：

```sh
/Users/tz/.bun/bin/bun test
/Users/tz/.bun/bin/bunx tsc --noEmit
git diff --check
```

预期：全部通过。
