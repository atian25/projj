# install / clean / stop intent 设计

日期：2026-04-30

## 结论

这轮扩展沿用现有 `run` intent 模型：

- `projj run <task>` 仍是唯一核心执行模型。
- `projj install`、`projj clean`、`projj stop` 是当前目录短入口，分别等价于当前目录里的 `projj run install`、`projj run clean`、`projj run stop`。
- 批量和筛选能力继续属于 `run`，例如 `projj run install --filter 'atian25/*'` 或 `projj run clean --all --dry-run`。
- 三个 intent 都走同一套 explicit lookup、intent fallback、参数追加、dry-run 和 lifecycle hooks 语义。
- `install` 对 `package.json scripts.install` 做特殊处理：不把它当作安装依赖命令。
- `clean` 不内置删除 `dist`、`tmp`、`node_modules`，也不自动执行 `git clean`。
- `stop` 不内置杀端口、杀进程或读取 pidfile。

## 命令形态

新增三个当前目录短入口：

```sh
projj install [--dry-run] [-- ...args]
projj clean [--dry-run] [-- ...args]
projj stop [--dry-run] [-- ...args]
```

短入口只面向当前目录，不支持 `--all` 或 `--filter`。跨仓库使用：

```sh
projj run install --filter 'atian25/*'
projj run clean --all --dry-run
projj run stop --filter egg -- --graceful
```

短入口找不到命令时使用当前目录语义的错误：

```text
No install command found in current directory.
No clean command found in current directory.
No stop command found in current directory.
```

`projj run <intent>` 找不到命令时继续使用通用 task-not-found 提示。

## 解析模型

三个 intent 继续复用现有两层解析：

```text
1. provider explicit lookup
2. provider-aware intent fallback
```

显式配置优先于内置 fallback。优先级保持：

```text
.projj.toml [tasks].<task>
package.json scripts.<task>
Makefile / justfile / Taskfile 的 <task>
~/.projj/config.toml [tasks].<task>
intent fallback
```

`install` 是唯一例外：当 task name 是 `install` 时，package provider 的 explicit lookup 跳过 `package.json scripts.install`。这是因为 npm 生态中的 `scripts.install` 是 lifecycle script，不是用户通常理解的“安装依赖”命令。

如果用户确实需要自定义 install 流程，应使用 `.projj.toml [tasks].install`、Makefile / justfile / Taskfile 的 `install`，或全局 `[tasks].install`。

## install Intent

`install` 的目标是安装当前项目依赖，而不是安装当前项目产物。

解析顺序：

```text
1. explicit install task
   - .projj.toml [tasks].install
   - Makefile / justfile / Taskfile 的 install
   - ~/.projj/config.toml [tasks].install

2. package dependency install fallback
   - bun.lock / bun.lockb -> bun install
   - pnpm-lock.yaml       -> pnpm install
   - yarn.lock            -> yarn install
   - package.json         -> npm install
```

不提供 Cargo 或 Go 的 install fallback。`cargo install` 和 `go install` 更接近“安装某个二进制或包”，不是“安装项目依赖”，容易和 `projj install` 的日常语义混淆。

`--` 后的参数追加到最终命令：

```sh
projj install -- --frozen-lockfile
```

示例解析：

```text
pnpm install --frozen-lockfile
```

## clean Intent

`clean` 的目标是调用项目认可的清理入口，不替用户推断哪些目录可以删除。

解析顺序：

```text
1. explicit clean task
   - .projj.toml [tasks].clean
   - package.json scripts.clean
   - Makefile / justfile / Taskfile 的 clean
   - ~/.projj/config.toml [tasks].clean

2. language fallback
   - Cargo.toml -> cargo clean
```

不内置这些行为：

```text
rm -rf dist
rm -rf tmp
rm -rf node_modules
git clean
go clean
```

这些操作都可能删除用户未预期的数据。如果项目需要强清理，应显式写在 `.projj.toml`、项目 task runner 或全局配置里。

后续如果要支持 git ignored 文件清理，应单独设计更明确的危险操作，例如 `projj clean --git` 或新的 `projj prune`，并配套 dry-run 和确认机制。

## stop Intent

`stop` 的目标是调用项目声明的停止入口，不猜测运行中的服务。

解析顺序：

```text
1. explicit stop task
   - .projj.toml [tasks].stop
   - package.json scripts.stop
   - Makefile / justfile / Taskfile 的 stop
   - ~/.projj/config.toml [tasks].stop
```

不提供语言 fallback，也不内置这些行为：

```text
kill by port
kill by process name
read pidfile
docker compose down
```

如果项目需要这些停止语义，应显式定义 `stop` task。

## Lifecycle Hooks

三个 intent 都参与现有 lifecycle hooks：

```text
projj install -> pre_install / post_install
projj clean   -> pre_clean / post_clean
projj stop    -> pre_stop / post_stop
```

执行规则和 `start` 一致：

- `pre_<task>` 失败：不执行主命令，不执行 `post_<task>`，返回失败码。
- 主命令失败：不执行 `post_<task>`，返回主命令失败码。
- `post_<task>` 失败：返回 `post_<task>` 的失败码。
- raw command 不触发 lifecycle hooks。
- dry-run 只预览主命令，不执行 hooks。

## Dry Run

短入口 dry-run 使用当前目录文案：

```text
Would install current project
$ pnpm install

Would clean current project
$ cargo clean

Would stop current project
$ npm run stop
```

`projj run <intent> --dry-run` 继续使用通用文案：

```text
Would run in current directory: install
$ pnpm install
```

批量 dry-run 继续按现有 `run` 输出每个仓库的解析命令。

## 任务列表

`projj run --list` 继续列出显式任务和检测任务。内置 intent fallback 不需要额外伪造成显式任务。

对于带 `package.json` 但没有 `scripts.install` 的项目，`projj run --list` 可以不展示 `install` fallback；用户通过 `projj install --dry-run` 或 `projj run install --dry-run` 查看解析结果。

## README 更新

README 需要增加：

- HELP usage 中的 `install`、`clean`、`stop`。
- 三个短入口命令说明。
- `install` 跳过 `package.json scripts.install` 的说明。
- `clean` 不自动删除目录、不自动 `git clean` 的说明。
- 批量用 `projj run <intent> --filter/--all` 的示例。

## 验收重点

需要覆盖这些流程：

- `projj install --dry-run` 在 Node 项目中解析为对应包管理器的 install 命令。
- `projj install` 跳过 `package.json scripts.install`，优先使用 `.projj.toml`、Makefile / justfile / Taskfile 或全局显式 task。
- `projj clean` 命中 `package.json scripts.clean`、Makefile / justfile / Taskfile `clean` 或 `cargo clean`。
- `projj clean` 不对普通 Node 项目推断 `rm -rf dist`、`rm -rf node_modules` 或 `git clean`。
- `projj stop` 只命中显式 stop task。
- `projj run install|clean|stop --filter/--all` 继续使用批量 run 调度。
- 三个短入口支持 `--dry-run` 和 `-- ...args`。
- 三个 intent 都触发对应 `pre_` / `post_` hooks。
- 找不到短入口命令时返回 1，并打印当前目录语义的错误。

