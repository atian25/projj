# 项目任务解析实现计划

> **给执行 Agent 的要求：** 实现本计划时，必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。按任务逐项执行，使用复选框（`- [x]`）跟踪进度。

**目标：** 让 `projj run` 先解析执行目录中的项目任务，再回退到全局任务和原始 shell 命令。

**架构：** 新增一个聚焦的任务解析模块。它接收 execution cwd、任务名或原始命令、追加参数和全局 tasks，并返回该 cwd 下实际执行的 shell 命令。`cli.ts` 在当前目录模式调用一次解析器，在 `--all`/`--filter` 模式对每个 repo 单独调用解析器。

**技术栈：** Bun test、TypeScript、`smol-toml`、Node `fs/promises` 和 `path`。不新增运行时依赖。

---

### 任务 1：本地任务解析核心

**文件：**
- 新建：`src/tasks.ts`
- 新建：`test/tasks.test.ts`
- 修改：`src/run.ts`

- [x] **步骤 1：写优先级失败测试**

添加测试，创建临时目录并验证：

```ts
expect(await resolveRunCommand("test", [], { test: "global test" }, cwd)).toBe("bun test");
expect(await resolveRunCommand("dev", [], { dev: "global dev" }, cwd)).toBe("pnpm run dev");
expect(await resolveRunCommand("status", [], { status: "git status --short" }, cwd)).toBe("git status --short");
expect(await resolveRunCommand("git status", [], {}, cwd)).toBe("git status");
```

测试 fixture 需要包含 `.projj.toml`、`package.json` 和对应 lockfile，用来证明项目任务优先于全局 tasks。

- [x] **步骤 2：运行测试并确认 RED**

运行：

```sh
/Users/tz/.bun/bin/bun test test/tasks.test.ts
```

预期：失败，因为 `src/tasks.ts` 和 `resolveRunCommand` 还不存在。

- [x] **步骤 3：实现最小解析器**

新建 `src/tasks.ts`，导出：

```ts
export async function resolveRunCommand(
  commandOrTask: string,
  args: string[],
  globalTasks: Record<string, string>,
  cwd: string,
): Promise<string>;
```

解析顺序：

```text
.projj.toml [tasks]
package.json scripts
global tasks
raw command
```

追加参数使用现有 `shellQuote` 语义，可以从 `src/run.ts` 移动或复用。

- [x] **步骤 4：运行测试并确认 GREEN**

运行：

```sh
/Users/tz/.bun/bin/bun test test/tasks.test.ts test/run.test.ts
```

预期：全部通过。

### 任务 2：常见项目任务探测器

**文件：**
- 修改：`src/tasks.ts`
- 修改：`test/tasks.test.ts`

- [x] **步骤 1：写探测器失败测试**

添加测试覆盖：

```text
Makefile test      -> make test
justfile test      -> just test
Taskfile.yml test  -> task test
Cargo.toml test    -> cargo test
go.mod test        -> go test ./...
```

同时测试 package manager lockfile 优先级：

```text
bun.lock 或 bun.lockb -> bun run test
pnpm-lock.yaml        -> pnpm run test
yarn.lock             -> yarn run test
package-lock.json     -> npm run test
```

- [x] **步骤 2：运行测试并确认 RED**

运行：

```sh
/Users/tz/.bun/bin/bun test test/tasks.test.ts
```

预期：探测器测试失败。

- [x] **步骤 3：实现探测顺序**

探测器顺序：

```text
package.json scripts
Makefile / makefile
justfile / Justfile
Taskfile.yml / Taskfile.yaml
Cargo.toml
go.mod
```

使用保守解析：

- `package.json` 通过 `JSON.parse`。
- Makefile 和 justfile 识别非注释的顶层 `task:` 行。
- Taskfile 识别 `tasks:` 下缩进的 `task:` 项。
- Cargo 和 Go 使用固定任务映射。

- [x] **步骤 4：运行测试并确认 GREEN**

运行：

```sh
/Users/tz/.bun/bin/bun test test/tasks.test.ts
```

预期：探测器测试全部通过。

### 任务 3：接入 CLI run

**文件：**
- 修改：`src/cli.ts`
- 修改：`test/cli.test.ts`
- 修改：`README.md`

- [x] **步骤 1：写 CLI 失败测试**

添加测试证明：

```text
projj run test
```

会优先使用当前 cwd 的 `package.json`，而不是全局 task。

再添加测试证明：

```text
projj run test --filter 'atian25/*'
```

会在每个匹配 repo 内独立解析 `test`。

- [x] **步骤 2：运行测试并确认 RED**

运行：

```sh
/Users/tz/.bun/bin/bun test test/cli.test.ts
```

预期：失败，因为 `cli.ts` 仍然只根据全局 tasks 解析一次命令。

- [x] **步骤 3：更新 CLI 执行路径**

修改 `cli.ts`：

- 当前目录模式调用 `resolveRunCommand(..., cwd)`。
- `--all`/`--filter` 先扫描 repo，再对每个 repo path 单独解析命令。
- 批量运行第一行保留用户输入的原始任务名或命令。
- 每个 repo 段落中的 `$ <command>` 展示该 repo 实际解析后的命令。

- [x] **步骤 4：运行测试并确认 GREEN**

运行：

```sh
/Users/tz/.bun/bin/bun test test/cli.test.ts test/tasks.test.ts
```

预期：全部通过。

### 任务 4：验证和文档

**文件：**
- 修改：`README.md`
- 修改：`docs/superpowers/specs/2026-04-29-project-task-resolution-design.md`

- [x] **步骤 1：更新 README 命令文档**

记录解析顺序：

```text
.projj.toml
项目任务探测器
全局 tasks
raw command
```

包含 `package.json`、`Makefile`、Cargo 和 Go 的例子。

- [x] **步骤 2：运行完整验证**

运行：

```sh
/Users/tz/.bun/bin/bun test
/Users/tz/.bun/bin/bunx tsc --noEmit
```

预期：全部测试通过，类型检查退出码为 0。

- [x] **步骤 3：检查 diff**

运行：

```sh
git diff --stat
git diff --check
```

预期：只改动任务解析相关源码、测试、README 和设计/计划文档；没有空白错误。
