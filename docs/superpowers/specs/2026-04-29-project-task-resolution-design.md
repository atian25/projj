# 项目任务解析设计

日期：2026-04-29

## 背景

当前 `projj run` 的任务解析只看全局配置：

```toml
# ~/.projj/config.toml
[tasks]
status = "git status --short"
pull = "git pull --ff-only"
fetch = "git fetch --all --prune"
```

如果命令名命中全局 task，就展开为配置命令；否则把用户输入当作原始 shell 命令执行。

这对通用仓库操作足够，但不能表达“项目自己定义的任务”。例如一个 Node.js 项目在 `package.json` 中已有：

```json
{
  "scripts": {
    "test": "vitest",
    "dev": "vite"
  }
}
```

用户直觉上会期望：

```sh
projj run test
projj run test --filter projj
```

优先执行该项目自己的 `test` script，而不是全局 task。

## 目标

让 `projj run` 在每个执行目录中解析项目本地任务，再回退到全局任务和原始命令。

设计目标：

- 当前目录模式和 repo 筛选模式使用同一套任务解析规则。
- 项目内定义优先于全局定义。
- 常见项目文件成为一等任务来源，包括 `package.json`、`Makefile`、`justfile`、`Taskfile.yml`、`Cargo.toml` 和 `go.mod`。
- 保留全局 tasks 作为跨仓库通用操作的 fallback。
- 保留 raw shell command 作为最后兜底，兼容当前用法。

## 本次不做

- 不新增 `projj exec`、`projj run-script` 等命令。
- 不实现任务列表 UI。
- 不解析 package manager workspace graph 或依赖拓扑。
- 不为多 repo 执行做并发调度。
- 不为 Python、Ruby、Java 等生态猜测默认任务；这些生态的任务入口差异较大，第一版通过 `.projj.toml`、`Makefile`、`justfile` 或 `Taskfile.yml` 覆盖。

## 任务解析优先级

在每个 execution cwd 中，按以下顺序解析 `projj run <command-or-task>`：

```text
1. 当前执行目录的 .projj.toml [tasks]
2. 当前执行目录的项目任务探测器
3. 全局 ~/.projj/config.toml [tasks]
4. 原始 shell command
```

`.projj.toml` 是项目对 `projj` 的显式配置，因此最高优先级。项目任务探测器读取项目已有的事实定义，因此高于用户全局 tasks。全局 tasks 更适合作为通用仓库操作，例如 `status`、`pull`、`fetch`。

## 当前目录模式

命令：

```sh
projj run test
```

行为：

1. 在当前目录查找 `.projj.toml`。
2. 如果有 `[tasks].test`，执行该命令。
3. 否则用项目任务探测器解析 `test`。
4. 如果命中，执行探测器返回的命令。
5. 否则查找全局 `[tasks].test`。
6. 否则把 `test` 当作原始 shell command。

## Repo 筛选模式

命令：

```sh
projj run test --filter 'atian25/*'
```

行为：

1. 扫描并筛选匹配 repo。
2. 对每个 repo，以该 repo 路径作为 execution cwd。
3. 在每个 repo 内独立按任务解析优先级解析 `test`。
4. 在对应 repo cwd 中执行解析后的命令。

这意味着同一个 `projj run test --filter '*'` 可以在不同仓库中展开成不同命令：

```text
github.com/atian25/projj   -> bun run test
github.com/foo/web         -> pnpm run test
github.com/bar/lib         -> make test
github.com/baz/api         -> go test ./...
```

## 项目任务探测器

项目任务探测器按固定顺序运行。第一版顺序：

```text
1. package.json scripts
2. Makefile
3. justfile / Justfile
4. Taskfile.yml / Taskfile.yaml
5. Cargo.toml
6. go.mod
```

如果多个项目文件同时存在，前面的探测器优先。项目可以用 `.projj.toml` 覆盖这个默认顺序。

### package.json scripts

如果 `package.json` 中存在目标 script，`projj` 不直接执行 script 内容，而是执行对应包管理器命令：

```text
<package-manager> run <script>
```

这样可以保留包管理器注入的环境变量、PATH、生命周期行为和参数转发规则。

包管理器检测按当前目录文件判断：

```text
bun.lockb 或 bun.lock     -> bun
pnpm-lock.yaml            -> pnpm
yarn.lock                 -> yarn
package-lock.json         -> npm
其他 package.json          -> npm
```

参数追加沿用当前 `--` 规则：

```sh
projj run test -- --watch
```

如果解析为 package script，则执行：

```sh
<package-manager> run test -- --watch
```

### Makefile

如果当前目录存在 `Makefile` 或 `makefile`，并且存在同名 target，则执行：

```sh
make <task>
```

例如：

```sh
projj run test
```

命中 `Makefile` 中的 `test:` 后执行：

```sh
make test
```

第一版只识别简单 target 行：

```make
test:
build:
lint:
```

不解析动态 target、include 文件或 make 内部变量。

### justfile

如果当前目录存在 `justfile` 或 `Justfile`，并且存在同名 recipe，则执行：

```sh
just <task>
```

第一版只识别简单 recipe 行：

```make
test:
build:
lint:
```

### Taskfile

如果当前目录存在 `Taskfile.yml` 或 `Taskfile.yaml`，并且 `tasks` 下存在同名任务，则执行：

```sh
task <task>
```

第一版只需要识别常见 YAML 结构：

```yaml
tasks:
  test:
    cmds:
      - go test ./...
```

如果 YAML 解析失败，该探测器失败并返回错误。

### Cargo.toml

如果当前目录存在 `Cargo.toml`，按内置任务映射解析：

```text
test   -> cargo test
build  -> cargo build
check  -> cargo check
run    -> cargo run
bench  -> cargo bench
doc    -> cargo doc
fmt    -> cargo fmt
clippy -> cargo clippy
```

未在映射表中的任务不命中，继续回退。

### go.mod

如果当前目录存在 `go.mod`，按内置任务映射解析：

```text
test  -> go test ./...
build -> go build ./...
run   -> go run .
fmt   -> go fmt ./...
vet   -> go vet ./...
```

未在映射表中的任务不命中，继续回退。

## .projj.toml

项目内 `.projj.toml` 格式：

```toml
[tasks]
test = "bun test"
dev = "bun run dev"
build = "bun run build"
```

第一版只支持 `[tasks]`。路径、base、platform 等全局配置仍只从 `~/.projj/config.toml` 读取。

## Raw Command 兼容

如果所有任务来源都未命中，仍沿用现有行为，把用户输入当作原始 shell command：

```sh
projj run git status
projj run bun test
```

在多 repo 模式下也保持这个 fallback：

```sh
projj run git status --filter 'atian25/*'
```

会在每个匹配 repo 中执行 `git status`。

## 输出

`run --filter` 和 `run --all` 的输出格式不变，只是 `$ <command>` 显示每个 repo 实际解析后的命令。

示例：

```text
Running in 2 repositories: test
==> github.com/atian25/projj
$ bun test
==> github.com/foo/web
$ pnpm run test
```

第一行保留用户输入的任务名，repo 下面的 `$ ...` 展示实际执行命令，方便看出每个项目的解析结果。

## 错误处理

- `.projj.toml` 存在但格式非法：该 repo 执行失败，并输出配置错误。
- `package.json` 存在但 JSON 非法：该 repo 执行失败，并输出解析错误。
- `Taskfile.yml` 或 `Taskfile.yaml` 存在但 YAML 非法：该 repo 执行失败，并输出解析错误。
- package script 不存在：继续回退到全局 task 或 raw command。
- Makefile/justfile target 不存在：继续回退到后续探测器、全局 task 或 raw command。
- Cargo/Go 内置任务映射不存在：继续回退到全局 task 或 raw command。
- 包管理器命令不存在：由 shell 执行失败并返回对应退出码。

多 repo 模式沿用当前退出码策略：遍历所有匹配 repo，任一 repo 返回非 0，则最终返回最后一个非 0 退出码。

## 测试策略

需要覆盖：

- 当前目录 `.projj.toml` task 优先于 package script。
- 当前目录 package script 优先于全局 task。
- Makefile target 能解析为 `make <task>`。
- justfile recipe 能解析为 `just <task>`。
- Taskfile task 能解析为 `task <task>`。
- Cargo 内置任务映射能解析常见 Rust 命令。
- Go 内置任务映射能解析常见 Go 命令。
- 当前目录全局 task 优先于 raw command。
- `--filter` 多 repo 模式中每个 repo 独立解析任务。
- package manager 根据 lockfile 选择 bun、pnpm、yarn、npm。
- `--` 后参数追加到 `.projj.toml` task、项目探测器命令和 raw command。
- 非法 `.projj.toml`、非法 `package.json` 和非法 Taskfile 返回失败。
