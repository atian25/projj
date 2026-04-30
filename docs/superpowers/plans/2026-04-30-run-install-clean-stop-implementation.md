# install / clean / stop intent 实现计划

> **给执行 Agent 的要求：** 按本计划逐项执行，使用复选框（`- [ ]`）追踪进度。每个任务先补测试，再实现，再运行相关测试。

**目标：** 为 `projj` 增加 `install`、`clean`、`stop` 三个 intent fallback，并提供当前目录短入口 `projj install`、`projj clean`、`projj stop`。

**架构：** 继续复用现有 `run` 核心执行模型。`src/tasks.ts` 负责解析 intent 和 provider fallback；`src/cli.ts` 只新增短入口分支，行为与 `start` 一致；README 更新用户可见命令和安全边界。

**技术栈：** Bun、TypeScript、`node:util parseArgs`、`bun:test`。不新增依赖。

---

## 文件结构

- 修改：`src/tasks.ts`，扩展 intent fallback，跳过 `package.json scripts.install`。
- 修改：`src/cli.ts`，新增 `install`、`clean`、`stop` 当前目录短入口。
- 修改：`test/tasks.test.ts`，覆盖解析优先级、fallback 和保守边界。
- 修改：`test/cli.test.ts`，覆盖短入口、dry-run、参数追加、hooks 和错误。
- 修改：`README.md`，补命令说明和安全行为。
- 新增：`docs/superpowers/plans/2026-04-30-run-install-clean-stop-implementation.md`，记录本实现计划。

### 任务 1：任务解析和 intent fallback

**文件：**
- 修改：`test/tasks.test.ts`
- 修改：`src/tasks.ts`

- [ ] **步骤 1：补 install 解析测试**

覆盖：

- Node 项目按 lockfile 解析为 `bun install`、`pnpm install`、`yarn install`、`npm install`。
- `install` 跳过 `package.json scripts.install`。
- `.projj.toml [tasks].install`、Makefile / justfile / Taskfile 的 `install`、全局 `[tasks].install` 仍可显式命中。
- `Cargo.toml` 和 `go.mod` 不提供 install fallback。

- [ ] **步骤 2：补 clean / stop 解析测试**

覆盖：

- `clean` 命中 `package.json scripts.clean`、Makefile / justfile / Taskfile `clean`、`Cargo.toml -> cargo clean`。
- 普通 Node 项目没有 `scripts.clean` 时不推断 `rm -rf dist`、`node_modules` 或 `git clean`。
- `go.mod` 不提供 clean fallback。
- `stop` 只命中显式 stop task，不提供语言或进程类 fallback。

- [ ] **步骤 3：实现 `src/tasks.ts`**

实现要点：

- 为 package provider 的 explicit lookup 增加 `install` 特例：当 task 是 `install` 时跳过 `scripts.install`。
- 新增 package install fallback：存在 `package.json` 时根据 lockfile 返回 `<manager> install`。
- Cargo fallback 增加 `clean: "cargo clean"`。
- Go fallback 不增加 `clean` 或 `install`。
- `stop` 不需要 fallback，只复用 explicit lookup。

- [ ] **步骤 4：运行 tasks 测试**

运行：

```sh
bun test test/tasks.test.ts
```

预期：全部通过。

### 任务 2：当前目录短入口

**文件：**
- 修改：`test/cli.test.ts`
- 修改：`src/cli.ts`

- [ ] **步骤 1：补短入口 dry-run 和执行测试**

覆盖：

- `projj install --dry-run` 输出 `Would install current project` 和解析命令，不执行 shell。
- `projj clean --dry-run` 输出 `Would clean current project`。
- `projj stop --dry-run` 输出 `Would stop current project`。
- 三个短入口真实执行时调用解析出的命令，cwd 是当前目录。
- 三个短入口支持 `-- ...args` 参数追加。

- [ ] **步骤 2：补错误和参数测试**

覆盖：

- 找不到命令时分别输出：
  - `No install command found in current directory.`
  - `No clean command found in current directory.`
  - `No stop command found in current directory.`
- 短入口不接受 `--all` 或 `--filter`，由 `parseArgs` 返回错误并进入统一错误处理。

- [ ] **步骤 3：实现 `src/cli.ts`**

实现要点：

- HELP usage 增加：

```text
projj install [--dry-run] [-- ...args]
projj clean [--dry-run] [-- ...args]
projj stop [--dry-run] [-- ...args]
```

- 抽出或复用当前 `start` 分支逻辑，避免四个短入口重复大量代码。
- 三个新短入口使用 `loadConfigOrDefault`，保证没有配置文件时仍可对当前项目做 package fallback。
- dry-run heading 分别为：
  - `Would install current project`
  - `Would clean current project`
  - `Would stop current project`

- [ ] **步骤 4：运行 CLI 测试**

运行：

```sh
bun test test/cli.test.ts
```

预期：全部通过。

### 任务 3：lifecycle hooks 覆盖

**文件：**
- 修改：`test/cli.test.ts`

- [ ] **步骤 1：补 hooks 测试**

覆盖一个代表性短入口即可，例如 `install`：

- `pre_install` 在主命令前执行。
- `post_install` 在主命令成功后执行。
- `pre_install` 失败时跳过主命令和 `post_install`。

`clean` 和 `stop` 共享 `runTaskLifecycle`，不需要重复完整失败矩阵；可以用 dry-run 或执行测试确认 task name 传入正确。

- [ ] **步骤 2：运行相关测试**

运行：

```sh
bun test test/cli.test.ts
```

预期：全部通过。

### 任务 4：批量 run 行为

**文件：**
- 修改：`test/cli.test.ts`

- [ ] **步骤 1：补 `projj run install|clean|stop --filter/--all` 测试**

覆盖：

- `projj run install --filter <selector> --dry-run` 在 Node repo 中解析为包管理器 install。
- `projj run clean --filter <selector> --dry-run` 在 Cargo repo 中解析为 `cargo clean`。
- `projj run stop --filter <selector>` 命中显式 stop task。

- [ ] **步骤 2：确认无需改 CLI 批量分支**

这些命令应自动复用现有 `run` 分支。若测试失败，只修复 task resolution 或既有 `runTaskLifecycle` 调用，不新增独立批量逻辑。

### 任务 5：README 和全量验证

**文件：**
- 修改：`README.md`

- [ ] **步骤 1：更新 README**

补充：

- Quick Start 或 Commands 中加入 `projj install --dry-run`、`projj clean --dry-run`、`projj stop --dry-run` 示例。
- `projj run` intent fallback 段落加入 install / clean / stop。
- 新增三个短入口小节。
- 明确 `install` 跳过 `package.json scripts.install`。
- 明确 `clean` 不自动删除 `dist`、`tmp`、`node_modules`，不自动 `git clean`。
- 明确批量使用 `projj run <intent> --filter/--all`。

- [ ] **步骤 2：运行全量验证**

运行：

```sh
bun test
bun run typecheck
```

预期：全部通过。

- [ ] **步骤 3：检查最终 diff**

确认：

- 没有无关文件改动。
- README 与实现行为一致。
- 设计文档、计划文档、测试和代码没有相互矛盾。

