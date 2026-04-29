# projj run --list 设计

日期：2026-04-29

## 背景

`projj run` 已经可以从执行目录解析项目任务：

```text
1. .projj.toml [tasks]
2. 项目任务探测器
3. 全局 ~/.projj/config.toml [tasks]
4. raw shell command
```

但用户在执行前不知道某个 repo 到底有哪些可运行任务。尤其在 `--filter` 匹配多个 repo 时，同一个任务名可能在不同项目中展开成不同命令。

下一步新增 `projj run --list`，只发现和展示任务，不执行命令。

## 目标

支持：

```sh
projj run --list
projj run --list --filter egg-view
projj run --list --all
```

设计目标：

- 当前目录模式下列出当前项目可用任务。
- `--filter`/`--all` 模式下列出匹配 repo 的可用任务。
- 输出按任务来源分组，帮助用户判断任务来自哪里。
- 与现有任务解析来源保持一致。
- 第一版输出面向人阅读，不承诺机器稳定格式。

## 本次不做

- 不新增顶层 `projj tasks` 命令。
- 不新增 `--json`。
- 不执行任何任务。
- 不解析 package manager workspace graph。
- 不深度解析 Makefile include、动态 target 或复杂 YAML 模板。

## 命令形态

更新后的 `run` 语法：

```text
projj run --list [--all] [--filter <selector>]
projj run <command-or-task> [--all] [--filter <selector>] [-- ...args]
```

行为：

- `projj run --list`：列出当前目录可用任务。
- `projj run --list --filter <selector>`：列出匹配 repo 的可用任务。
- `projj run --list --all`：列出全部已发现 repo 的可用任务。
- `--list` 与具体 command/task 互斥；如果同时提供，返回 usage 错误。
- `--list` 忽略 `--` 后参数；如果传入 `--` 后参数，返回 usage 错误。

## 输出格式

当前目录模式：

```text
Tasks in /Users/tz/projj/github.com/eggjs/egg-view

.projj.toml
  test        echo local-test

package.json
  lint        eslint . --fix
  test        npm run lint -- --fix && npm run test-local
  test-local  egg-bin test

global (/Users/tz/.projj/config.toml)
  status      git status --short
  pull        git pull --ff-only
  fetch       git fetch --all --prune

detected
  make:test   make test
```

Repo 模式：

```text
Tasks in 2 repositories

==> github.com/eggjs/egg-view
package.json
  lint        eslint . --fix
  test        npm run lint -- --fix && npm run test-local
global (/Users/tz/.projj/config.toml)
  status      git status --short
  pull        git pull --ff-only
  fetch       git fetch --all --prune

==> github.com/atian25/projj
package.json
  test        bun test
  typecheck   bunx tsc --noEmit
global (/Users/tz/.projj/config.toml)
  status      git status --short
  pull        git pull --ff-only
  fetch       git fetch --all --prune
```

规则：

- 任务按来源分组。
- 同一来源内按任务名排序。
- 没有任务的来源不输出。
- `package.json` 显示 script 原始内容，而不是 `npm run <script>`。
- `.projj.toml` 和全局 tasks 显示配置命令。
- 内置探测器显示将要执行的命令，例如 `cargo:test  cargo test`。

## 任务来源

`--list` 使用和 `run` 一致的项目任务来源：

```text
.projj.toml [tasks]
package.json scripts
Makefile / makefile
justfile / Justfile
Taskfile.yml / Taskfile.yaml
Cargo.toml
go.mod
global ~/.projj/config.toml [tasks]
```

`raw shell command` 不是可发现任务，因此不列出。

## 冲突展示

如果多个来源定义同名任务，`run` 会按优先级执行最高优先级来源。`--list` 第一版仍展示所有来源，让用户能看到覆盖关系。

示例：

```text
.projj.toml
  test        bun test

package.json
  test        vitest

global (/Users/tz/.projj/config.toml)
  test        npm test
```

后续如果需要，可以增加“effective” 标记；第一版不做。

## 错误处理

- `.projj.toml` 格式非法：当前目录或对应 repo list 失败，输出错误并返回非 0。
- `package.json` JSON 非法：当前目录或对应 repo list 失败，输出错误并返回非 0。
- `Taskfile.yml` 或 `Taskfile.yaml` 解析失败：当前目录或对应 repo list 失败，输出错误并返回非 0。
- `--filter` 没有匹配 repo：输出 `Tasks in 0 repositories` 并返回 0，和 `run --filter` 的空匹配策略一致。

多 repo 模式下，一个 repo 解析失败不阻止后续 repo；最终返回最后一个非 0 错误码。

## 测试策略

需要覆盖：

- `projj run --list` 列出当前目录 `.projj.toml`、`package.json`、全局 tasks。
- `projj run --list --filter <selector>` 列出匹配 repo 的任务。
- `--list` 与 command/task 同时使用时报 usage 错误。
- package scripts 按名称排序并显示原始 script 内容。
- Makefile、justfile、Taskfile、Cargo、Go 任务能被列出。
- 非法 `.projj.toml`、非法 `package.json`、非法 Taskfile 返回失败。
