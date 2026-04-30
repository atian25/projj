# status 短入口设计

日期：2026-04-30

## 结论

这轮新增 `projj status` 作为当前目录短入口。它属于现有 `run` task 模型，不是新的仓库状态分析器。

- `projj status` 等价于当前目录里的 `projj run status`。
- `status` 提供内置 fallback：`git status --short --branch`。
- 如果用户定义了 `status` task，显式定义优先于内置 fallback。
- 批量、筛选和 changed 过滤继续属于 `run`，例如 `projj run status --all`、`projj run status --filter egg`、`projj run status --changed`。
- `projj status` 支持 `--dry-run` 和 `-- ...args`，不支持 `--all`、`--filter`、`--changed`。
- lifecycle hooks 按 task name 触发，即 `pre_status` / `post_status`。

## 命令形态

新增当前目录短入口：

```sh
projj status [--dry-run] [-- ...args]
```

示例：

```sh
projj status
projj status --dry-run
projj status -- --short
```

跨仓库场景继续使用 `run`：

```sh
projj run status --all
projj run status --filter egg
projj run status --changed
projj run status --filter egg --changed --dry-run
```

## 任务解析

`status` 先使用现有 explicit task resolution：

```text
.projj.toml [tasks].status
package.json scripts.status
Makefile / justfile / Taskfile 的 status
~/.projj/config.toml [tasks].status
```

如果没有显式 task，内置 fallback 为：

```text
git status --short --branch
```

这会保留 `run` task 模型，同时让默认输出包含 branch、ahead / behind 和工作区改动信息。

不新增这些独立分析行为：

```text
内部解析 branch / upstream / ahead / behind
JSON 输出
自定义状态块渲染
```

如果用户希望覆盖默认 status，应显式配置：

```toml
[tasks]
status = "git status --short"
```

没有任何显式配置时：

```sh
projj status
```

运行：

```text
git status --short --branch
```

## 与 run 的关系

`projj status` 只是短入口，不复制 `run` 的调度能力。

当前目录：

```sh
projj status
projj run status
```

两者应解析到同一个 task，触发同一组 lifecycle hooks，并使用同一套错误处理。

批量或筛选：

```sh
projj run status --all
projj run status --filter 'atian25/*'
```

`projj status --all` 和 `projj status --filter ...` 应被参数解析拒绝，避免短入口长出独立调度语义。

## Dry Run 和参数追加

dry-run 使用当前目录短入口文案：

```text
Would status current project
$ git status --short --branch
```

`--` 后的参数追加到最终解析出的命令：

```sh
projj status -- --ignored
```

如果使用内置 fallback：

```text
git status --short --branch --ignored
```

如果命中 package script：

```text
pnpm run status -- --branch
```

## Lifecycle Hooks

`status` 参与现有 lifecycle hooks：

```text
pre_status
status
post_status
```

执行规则和其他 task 相同：

- `pre_status` 失败：不执行主命令，不执行 `post_status`，返回失败码。
- 主命令失败：不执行 `post_status`，返回主命令失败码。
- `post_status` 失败：返回 `post_status` 的失败码。
- dry-run 只预览主命令，不执行 hooks。

## 错误处理

由于 `status` 有内置 fallback，普通 git 仓库中不会因为缺少 task 定义而报找不到 task。

如果 fallback 命令执行失败，返回底层命令的退出码。比如当前目录不是 git 仓库时，`git status --short --branch` 会失败，`projj status` 返回失败码。

`projj run status` 与 `projj status` 使用同一个 resolver，因此也会得到相同 fallback。

## README 更新

README 需要补充：

- HELP usage 中的 `projj status [--dry-run] [-- ...args]`。
- `projj status` 小节，说明它是 `projj run status` 的当前目录短入口。
- 明确 `status` 的内置 fallback 是 `git status --short --branch`。
- 明确用户可以通过 `[tasks].status` 或项目 task 覆盖默认实现。
- 批量状态继续使用 `projj run status --all/--filter/--changed`。

## 验收重点

需要覆盖这些流程：

- `projj status --dry-run` 在没有显式 task 时命中内置 fallback。
- 显式 `[tasks].status` 优先于内置 fallback。
- `projj status` 与当前目录 `projj run status` 使用同一 task resolution。
- `projj status -- --branch` 会追加参数。
- `projj status` 触发 `pre_status` / `post_status` hooks。
- `projj status` 没有显式 task 时执行 `git status --short --branch`。
- `projj status --filter egg`、`projj status --all`、`projj status --changed` 被拒绝。
- `projj run status --all/--filter/--changed` 行为不变。
