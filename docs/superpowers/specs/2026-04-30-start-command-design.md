# run 任务解析、lifecycle 与 start intent 设计

日期：2026-04-30

## 结论

这轮设计最终收敛为：

- `projj run <task>` 是唯一核心执行模型。
- `projj start` 是当前目录里的 `projj run start` 短入口。
- `start`、`test`、`build`、`install`、`clean`、`stop` 等都应被理解为 task name，其中一部分 task name 可以拥有 provider-aware intent fallback。
- `projj start` 不复制 `run` 的调度能力；批量启动使用 `projj run start --filter/--all`。
- lifecycle 属于 `run <task>` 的前后包裹，即 `pre_<task>` / `post_<task>`，不是独立命令系统。
- raw command 必须显式使用 `projj run -- <command>`，不参与 task resolution，也不触发 lifecycle hooks。
- 默认配置不再内置 `status`、`pull`、`fetch`；用户需要时显式配置。
- 找不到 task 时应基于已检测到的 provider 给出下一步提示。

## 设计修正

早期分支里的 `start` 方案偏向“新增一个 start 命令，并在里面做生命周期和兜底”。这会带来两个问题：

- `projj start` 和 `projj run start` 的关系不清楚。
- `start`、`install`、`clean`、`stop` 以后都可能各自长出一套重复的解析逻辑。

讨论后修正为：`run` 负责解析和执行 task，短入口只负责转发到 `run <intent>`。因此 `start` 的兜底不应该是一个独立 subsystem，而应是 `run start` 在 provider 层的 intent fallback。

## 核心模型

`projj run <task>` 的解析分两层。这里的“显式”和“兜底”都发生在 provider 内部；顶层模型只负责按 provider 顺序询问。

第一层是 provider explicit lookup：每个 provider 在自己的原生配置里找名字等于 `<task>` 的入口。

```text
.projj.toml provider      -> [tasks].<task>
package provider          -> package.json scripts.<task>
make / just / taskfile    -> target / recipe / task named <task>
global config provider    -> [tasks].<task>
```

第二层是 intent fallback：

```text
如果 <task> 是已知 intent，各 provider 可以按生态惯例推导命令。
```

伪代码：

```text
for provider in providers:
  command = provider.resolveExplicitTask(task)
  if command:
    return command

for provider in providers:
  command = provider.resolveIntentFallback(task)
  if command:
    return command

return not found
```

显式 task 永远优先于 fallback。例如全局 `[tasks].test` 应优先于 Cargo 项目的 `cargo test` fallback。

## Provider

Provider 通过项目文件判断自己是否适用于当前目录，并负责解析显式 task 或 intent fallback。

当前实现的 provider：

```text
projj local config
  file: .projj.toml
  explicit: [tasks].<task>
  fallback: none

package
  file: package.json
  explicit: scripts.<task>
  fallback: per intent

make
  file: Makefile / makefile
  explicit: target <task>
  fallback: per intent

just
  file: justfile / Justfile
  explicit: recipe <task>
  fallback: per intent

taskfile
  file: Taskfile.yml / Taskfile.yaml
  explicit: task <task>
  fallback: per intent

cargo
  file: Cargo.toml
  explicit: none
  fallback: per intent

go
  file: go.mod
  explicit: none
  fallback: per intent

global config
  file: ~/.projj/config.toml
  explicit: [tasks].<task>
  fallback: none
```

Cargo 和 Go 当前没有“原生命名 task”查找，只提供已知 intent fallback。

## Intent Fallback

当前已实现的 fallback：

```text
start
  package.json scripts.dev / scripts.serve
  Makefile / justfile / Taskfile 的 dev / serve / run
  Cargo.toml -> cargo run
  go.mod -> go run .

cargo/go common tasks
  Cargo.toml -> cargo test/build/check/run/bench/doc/fmt/clippy
  go.mod     -> go test/build/run/fmt/vet
```

未来可以扩展更多 intent，但每个 intent 应继续挂在 provider 模型上，而不是新增独立命令解析系统。

## Raw Command

`projj run <task>` 只接受一个 task name。找不到 task 时返回失败，不再自动把未知 task 当 raw shell command。

raw command 必须显式使用 `--`：

```sh
projj run -- git status
projj run --filter 'atian25/*' -- git status
```

raw command 不解析 task，也不自动运行 `pre_<task>` / `post_<task>` hooks。

## Not Found Hint

找不到 task 时，错误输出应告诉用户下一步怎么做。

如果检测到单一强 provider，例如 `package.json`：

```text
Task not found: ux
Detected package.json. Add scripts.ux to package.json or run a raw command with `projj run -- ux`.
```

如果检测到多个项目 provider：

```text
Task not found: ux
Detected package.json or Makefile. Add ux to the matching project task config or run a raw command with `projj run -- ux`.
```

如果没有检测到项目 provider：

```text
Task not found: ux
Define ux in .projj.toml [tasks], add a supported project task file, or run a raw command with `projj run -- ux`.
```

`global config` 不作为 detected provider 展示，因为它不是当前项目的原生 task 入口。

## start Intent

`start` 是第一版完整落地的 intent。

当前目录：

```sh
projj start
projj start --dry-run
projj start -- --host 0.0.0.0
projj run start
```

批量或筛选：

```sh
projj run start --filter 'atian25/*'
projj run start --all --dry-run
```

不支持 `projj start --filter/--all`。短入口只面向当前目录；调度能力属于 `run`。

`start` 解析顺序：

```text
1. explicit task lookup: start
   - .projj.toml [tasks].start
   - package.json scripts.start
   - Makefile / justfile / Taskfile 的 start
   - ~/.projj/config.toml [tasks].start

2. start fallback
   - package.json scripts.dev / scripts.serve
   - Makefile / justfile / Taskfile 的 dev / serve / run
   - Cargo.toml -> cargo run
   - go.mod -> go run .
```

`projj start` 可以保留当前目录语义的友好错误：

```text
No start command found in current directory.
```

`projj run start` 则使用通用 task-not-found 提示。

## 参数追加

`--` 后的参数追加到最终解析出的命令。

```sh
projj run start -- --host 0.0.0.0
projj start -- --host 0.0.0.0
```

如果命中 package script：

```text
pnpm run dev -- --host 0.0.0.0
```

如果命中直接配置的命令：

```text
pnpm dev --host 0.0.0.0
```

## Lifecycle Hooks

`projj run <task>` 正常执行时自动包裹：

```text
pre_<task> hooks
resolved task command
post_<task> hooks
```

示例：

```toml
[[hooks]]
event = "pre_test"
tasks = ["echo preparing"]

[[hooks]]
event = "post_test"
tasks = ["echo done"]
```

执行语义：

- `pre_<task>` 失败：不执行主命令，不执行 `post_<task>`，返回失败码。
- 主命令失败：不执行 `post_<task>`，返回主命令失败码。
- `post_<task>` 失败：返回 `post_<task>` 的失败码。
- raw command 不触发 lifecycle hooks。

`post_clone` 仍是 clone 专用 hook event；`pre_clone` 不属于本轮 lifecycle 泛化范围。

## Dry Run

`run` / `start` 的 dry-run 只预览主命令，不执行 hooks：

```text
Would run in current directory: start
$ pnpm run dev
```

`projj start` 使用更贴近日常命令的文案：

```text
Would start current project
$ pnpm run dev
```

后续如果要展示完整执行链，可以再设计：

```text
pre_start -> start -> post_start
```

## clone Dry Run

这轮讨论中顺手补了 `clone --dry-run`。它属于 clone 命令能力，不属于 `run` 模型。

```sh
projj clone atian25/ppt-test --dry-run
```

新目标：

```text
Would clone git@github.com:atian25/ppt-test.git
to ~/projj/github.com/atian25/ppt-test
```

目标已存在：

```text
Would skip existing ~/projj/github.com/atian25/ppt-test
```

dry-run 不 clone、不执行 `post_clone` hooks、不写 cd finalizer。

## 当前验收重点

需要覆盖这些主流程：

- `projj run <task>` explicit lookup。
- `projj run <task>` cargo/go fallback。
- `projj run unknown` provider-aware hint。
- `projj run -- <command>` raw command。
- `projj start` 与当前目录 `projj run start` 等价。
- `projj run start --filter/--all` 批量解析。
- `pre_<task>` / `post_<task>` 生命周期。
- raw command 不触发生命周期。
- `post_clone` 仍按 clone 语义运行。
- `projj clone --dry-run` 不产生副作用。

## 后续扩展

可继续在 provider 结构下扩展更多生态：

```text
Python
  pyproject.toml / manage.py / app.py

Docker
  compose.yaml / docker-compose.yml

Java
  pom.xml / build.gradle / gradlew
```

可继续扩展更多 intent：

```text
install
clean
stop
build
test
```

短入口命令仍应只是 `run <intent>` 的别名：

```sh
projj install  == projj run install
projj clean    == projj run clean
projj stop     == projj run stop
```

这类短入口默认只面向当前目录；批量能力继续使用 `projj run <intent> --filter/--all`。

`post_start` readiness、端口探测、异步健康检查可以后续单独设计，不进入当前实现。
