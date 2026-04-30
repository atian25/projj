# status 短入口实现计划

> **给执行 Agent 的要求：** 按本计划逐项执行，使用复选框（`- [ ]`）追踪进度。每个任务先补测试，再实现，再运行相关测试。

**目标：** 增加 `projj status` 当前目录短入口，使它等价于当前目录里的 `projj run status`。不新增 status fallback，不新增仓库状态分析器。

**架构：** 复用 `src/cli.ts` 里已有的 `runCurrentIntentShortcut`。`status` 和 `start/install/clean/stop` 一样走 `runTaskLifecycle`，因此自动复用 task resolution、参数追加、dry-run、lifecycle hooks 和错误处理。

**技术栈：** Bun、TypeScript、`node:util parseArgs`、`bun:test`。不新增依赖。

---

## 文件结构

- 修改：`src/cli.ts`，HELP usage 增加 `status`，switch 分支接入 `runCurrentIntentShortcut`。
- 修改：`test/cli.test.ts`，覆盖短入口 dry-run、执行、参数追加、hooks、错误和拒绝批量参数。
- 修改：`README.md`，补 `projj status` 小节和示例。
- 新增：`docs/superpowers/plans/2026-04-30-status-shortcut-implementation.md`，记录本实现计划。

### 任务 1：CLI 短入口行为

**文件：**
- 修改：`test/cli.test.ts`
- 修改：`src/cli.ts`

- [ ] **步骤 1：补 dry-run 和执行测试**

覆盖：

- `projj status --dry-run` 命中全局 `[tasks].status`，输出：

```text
Would status current project
$ git status --short
```

- `projj status` 真实执行解析出的命令，cwd 是当前目录。
- `projj status -- --branch` 会追加参数。

- [ ] **步骤 2：补错误和参数测试**

覆盖：

- 当前目录没有任何 `status` task 时，`projj status` 返回 1，并输出：

```text
No status command found in current directory.
```

- `projj status --all`、`projj status --filter egg`、`projj status --changed` 被参数解析拒绝。

- [ ] **步骤 3：实现 `src/cli.ts`**

实现要点：

- HELP usage 增加：

```text
projj status [--dry-run] [-- ...args]
```

- 在 switch 中把 `status` 加入当前目录短入口分支：

```ts
case "status":
case "start":
case "install":
case "clean":
case "stop":
  return await runCurrentIntentShortcut(command, rest);
```

- 不修改 `src/tasks.ts`，避免引入内置 fallback。

- [ ] **步骤 4：运行 CLI 测试**

运行：

```sh
/Users/tz/.bun/bin/bun test test/cli.test.ts
```

预期：全部通过。

### 任务 2：lifecycle hooks 和 run 行为

**文件：**
- 修改：`test/cli.test.ts`

- [ ] **步骤 1：补 lifecycle 测试**

覆盖：

- `projj status` 触发 `pre_status`。
- 主命令成功后触发 `post_status`。
- `pre_status` 失败时跳过主命令和 `post_status`。

- [ ] **步骤 2：确认 run 批量行为不变**

覆盖或复用现有测试确认：

- `projj run status --filter ...` 仍由 `run` 分支处理。
- `projj run status --changed` 仍使用既有 `--changed` 过滤逻辑。

若现有测试已覆盖 `run status`，不需要新增重复测试；只需确保新增短入口不改动 run 分支。

### 任务 3：README 和验证

**文件：**
- 修改：`README.md`

- [ ] **步骤 1：更新 README**

补充：

- Quick Start 可加入 `projj status --dry-run` 示例。
- 新增 `projj status [--dry-run] [-- ...args]` 小节。
- 明确 `projj status` 是 `projj run status` 的当前目录短入口。
- 明确 `status` 不提供内置 fallback，需要显式 task。
- 明确批量状态使用 `projj run status --all/--filter/--changed`。

- [ ] **步骤 2：运行全量验证**

运行：

```sh
/Users/tz/.bun/bin/bun test
/Users/tz/.bun/bin/bunx tsc --noEmit
```

预期：全部通过。

- [ ] **步骤 3：检查最终 diff**

确认：

- 没有修改 `src/tasks.ts`。
- README、spec、实现行为一致。
- `status` 没有内置 `git status --short` fallback。

