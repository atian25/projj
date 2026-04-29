# run 批量执行反馈实现计划

> **给执行 Agent 的要求：** 实现本计划时，必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。按任务逐项执行，使用复选框（`- [x]`）跟踪进度。

**目标：** 为 `projj run --all` 和 `projj run --filter` 增加失败汇总，并让 `--filter` 空匹配返回非 0。

**架构：** 只修改 `src/cli.ts` 的 run 分支。批量执行时收集失败 repo 的 key 和 exit code，执行结束后输出 summary。repo 扫描后如果用户传了 `--filter` 且结果为空，直接返回 1。

**技术栈：** Bun test、TypeScript。

---

### 任务 1：空匹配语义

**文件：**
- 修改：`test/cli.test.ts`
- 修改：`src/cli.ts`

- [x] **步骤 1：写失败测试**

覆盖：

```text
projj run test --filter nope
projj run --list --filter nope
```

预期返回 1，stderr 包含：

```text
No repositories matched: nope
```

同时覆盖 `projj run test --all` 在 0 repo 时仍返回 0。

- [x] **步骤 2：运行测试确认 RED**

运行：

```sh
/Users/tz/.bun/bin/bun test test/cli.test.ts
```

- [x] **步骤 3：实现空匹配判断**

在 `run` 和 `run --list` 的 repo 扫描后，如果 `filter` 存在且 repos 为空，输出 no match 到 stderr 并返回 1。

- [x] **步骤 4：运行测试确认 GREEN**

运行：

```sh
/Users/tz/.bun/bin/bun test test/cli.test.ts
```

### 任务 2：失败汇总

**文件：**
- 修改：`test/cli.test.ts`
- 修改：`src/cli.ts`

- [x] **步骤 1：写失败测试**

构造两个 repo：

```text
repo-a -> runShellCommand 返回 2
repo-b -> runShellCommand 返回 0
repo-c -> runShellCommand 返回 7
```

预期：

- 三个 repo 都被执行。
- stderr 输出失败汇总。
- 最终返回 7。

- [x] **步骤 2：运行测试确认 RED**

运行：

```sh
/Users/tz/.bun/bin/bun test test/cli.test.ts
```

- [x] **步骤 3：实现失败收集和 summary**

批量执行时维护：

```ts
const failures: Array<{ key: string; code: number }> = [];
```

每个 repo 返回非 0 时记录。循环结束后输出：

```text
Failed in N repository/repositories:
- <key> exited <code>
```

输出到 stderr。

- [x] **步骤 4：运行测试确认 GREEN**

运行：

```sh
/Users/tz/.bun/bin/bun test test/cli.test.ts
```

### 任务 3：文档和验证

**文件：**
- 修改：`README.md`
- 修改：`docs/superpowers/specs/2026-04-29-run-batch-feedback-design.md`

- [x] **步骤 1：更新 README**

在 `run` 小节说明：

- `--filter` 没匹配 repo 返回 1。
- 多 repo 失败时会在 stderr 输出失败汇总。

- [x] **步骤 2：完整验证**

运行：

```sh
/Users/tz/.bun/bin/bun test
/Users/tz/.bun/bin/bunx tsc --noEmit
git diff --check
```

预期：全部通过。
