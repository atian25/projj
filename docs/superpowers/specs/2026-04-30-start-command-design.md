# start 命令设计

日期：2026-04-30

## 背景

`projj` 已经能管理本地仓库目录、跳转仓库、批量运行任务，并且 `projj run` 已支持从项目文件中解析任务：

```text
package.json scripts
Makefile
justfile / Justfile
Taskfile.yml / Taskfile.yaml
Cargo.toml
go.mod
```

这让 `projj run test` 这类命令可以在不同语言或工具链项目中展开成不同命令。但用户进入一个仓库后，还有一个更直接的日常动作：启动当前项目。

`projj` 当前默认 tasks 已经包含 `pull` 和 `fetch`，因此 `up` 在这里容易被理解为“更新仓库”。本功能选择 `projj start`，语义聚焦在启动当前项目。

`projj start` 不引入第二套任务系统。它是 `projj run` 任务解析体系上的启动意图解析器：用户没有明确说要运行哪个任务名，只表达了“我要启动这个项目”，`projj` 帮用户在当前项目里选择最合适的启动入口。

## 目标

新增 `projj start`，让用户在项目目录中一键启动当前项目。

设计目标：

- 默认零配置可用。
- 显式项目任务优先于自动探测。
- 复用现有项目任务解析基础，按生态或工具链维护启动候选和语言默认兜底。
- 支持 `--dry-run` 预览将执行的命令。
- 支持 `--` 后参数追加到最终启动命令。
- 第一版只启动当前目录项目，不做批量启动。

## 本次不做

- 不实现 `projj setup`、`projj stop`、`projj down`。
- 不自动安装依赖、运行迁移或启动外部服务。
- 不做端口探测、浏览器打开、健康检查或后台 daemon 管理。
- 不做多仓库批量启动。
- 不为 Python、Ruby、Java、Docker Compose 等生态猜测启动命令；这些后续可以通过探测器扩展。

## 命令

```sh
projj start
projj start --dry-run
projj start -- --host 0.0.0.0
```

`projj start` 只在当前工作目录解析和执行启动命令。它不读取全局 `[tasks]`，因为启动项目是项目局部行为，不应该被全局通用 task 意外覆盖。

如果没有找到启动命令，返回 1 并输出：

```text
No start command found in current directory.
```

## 配置

`projj start` 复用现有 `.projj.toml [tasks]`，不新增 `[start]` 配置。

```toml
[tasks]
start = "pnpm dev"
```

`[tasks].start` 是当前项目的显式启动任务，优先级最高。这样 `projj start` 和 `projj run start` 在项目显式定义时会解析到同一个命令。

如果 `.projj.toml` 存在但 `[tasks].start` 不是字符串，沿用现有本地 task 配置错误：

```text
invalid local task config: tasks.start must be a string
```

第一版不新增 `commands` 数组、平台覆盖、环境变量注入或工作目录覆盖。

## 解析优先级

`projj start` 的解析顺序：

```text
1. .projj.toml [tasks].start
2. JavaScript/TypeScript detector
3. task runner detectors
4. Rust detector
5. Go detector
```

这些 detector 应该按生态或工具链分组维护，而不是在 CLI 分支里散落硬编码。推荐提供独立 API：

```ts
resolveStartTaskCommand(cwd: string): Promise<ResolvedCommand | undefined>
```

`ResolvedCommand` 复用现有任务解析的概念，至少包含：

```ts
type ResolvedCommand = {
  command: string;
  appendSeparator?: boolean;
};
```

## Detector 规则

### JavaScript/TypeScript

如果当前目录存在 `package.json`，按 scripts 优先级查找：

```text
dev
start
serve
```

命中后执行：

```text
<package-manager> run <script>
```

包管理器检测复用现有逻辑：

```text
bun.lock / bun.lockb -> bun
pnpm-lock.yaml       -> pnpm
yarn.lock            -> yarn
其他 package.json     -> npm
```

`package.json` 非法时，`projj start` 失败并输出解析错误。`package.json` 合法但没有候选 script 时，继续尝试后续 detector。

### Task Runners

按现有顺序检测：

```text
Makefile / makefile
justfile / Justfile
Taskfile.yml / Taskfile.yaml
```

每类 task runner 按候选名查找：

```text
dev
start
serve
run
```

命中后分别执行：

```text
make <target>
just <recipe>
task <task>
```

Taskfile 结构非法时失败。Makefile 和 justfile 中目标不存在时继续尝试后续 detector。

### Rust

如果当前目录存在 `Cargo.toml`，执行：

```text
cargo run
```

### Go

如果当前目录存在 `go.mod`，执行：

```text
go run .
```

## 参数追加

`--` 后的参数追加到最终命令。

示例：

```sh
projj start -- --host 0.0.0.0
```

如果命中 package script：

```text
pnpm run dev -- --host 0.0.0.0
```

如果命中 raw command style 的配置：

```text
pnpm dev --host 0.0.0.0
```

参数 quoting 复用现有 `shellQuote` 和 `appendArgs` 行为。

## Dry Run

`--dry-run` 只打印解析结果，不执行命令：

```text
Would start current project
$ pnpm run dev
```

如果追加参数：

```text
Would start current project
$ pnpm run dev -- --host 0.0.0.0
```

## 与 `projj run` 的关系

`projj start` 是 `projj run` 体系上的启动意图快捷入口，但不是 `projj run start` 的纯别名。

关系：

- `projj run <name>` 运行用户明确指定的任务名。
- `projj run start` 只解析名为 `start` 的任务，然后按现有规则回退到全局 task 或 raw command。
- `projj start` 表达“启动当前项目”的意图。它先尝试项目本地 `start` 任务，再尝试常见启动候选和语言默认兜底。
- `projj start` 不读取全局 tasks，也不回退到 raw command。

实现上应复用 `tasks.ts` 中的文件解析、包管理器检测、目标检测和参数追加逻辑，但保留独立入口。

## CLI 集成

`projj --help` 增加：

```text
projj start [--dry-run] [-- ...args]
```

`cli.ts` 新增 `start` 分支：

1. 用 `parseArgs` 解析 `--dry-run`。
2. 通过 `--` 分离追加参数。
3. 调用 `resolveStartTaskCommand(cwd)`。
4. 未命中时输出错误并返回 1。
5. dry-run 时打印命令并返回 0。
6. 用追加参数生成最终命令字符串。
7. 正常模式调用 `runShellCommand(command, cwd)`。

`CliDeps` 不需要新增执行依赖，沿用已有 `runShellCommand` 注入点。

## 测试

新增或扩展测试覆盖：

- `.projj.toml [tasks].start` 优先于 package script。
- `package.json scripts.dev` 解析为对应包管理器命令。
- `scripts.start` 和 `scripts.serve` 在 `dev` 不存在时作为 fallback。
- Makefile、justfile、Taskfile 的 `dev/start/serve/run` 候选能解析。
- Cargo 项目解析为 `cargo run`。
- Go 项目解析为 `go run .`。
- `--dry-run` 打印命令且不执行。
- `--` 后参数正确追加，package script 使用额外 `--`。
- 找不到启动命令时返回 1。
- 非法 `.projj.toml [tasks]` 配置、非法 `package.json`、非法 Taskfile 返回失败。

## 后续扩展

后续可以在同一 detector 结构下扩展：

```text
Python
  pyproject.toml / manage.py / app.py

Docker
  compose.yaml / docker-compose.yml

Java
  pom.xml / build.gradle / gradlew
```

也可以新增独立生命周期命令：

```sh
projj setup
projj stop
```

但这些不进入第一版。
