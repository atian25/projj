# projj run --filter 设计

日期：2026-04-29

## 背景

当前 `projj run` 支持：

```text
projj run <command-or-task>
projj run <command-or-task> --all
projj run <command-or-task> --all --match <regex>
```

其中 `--match` 是对 `host/owner/repo` 的正则过滤。这个能力适合脚本，但日常使用成本偏高：用户需要知道 repo key 的完整格式，也需要写正则转义。

下一步把 `--match` 改为 `--filter`，让 `run` 的批量选择语义更像面向人的 repo selector。`--filter` 本身表达了“去仓库集合里筛选”的意图，因此不要求用户同时传 `--all`。

## 目标

`projj run --filter` 用于从已发现仓库集合中筛选目标仓库。

示例：

```sh
projj run status --filter projj
projj run status --filter 'atian25/*'
projj run status --filter 'github.com/atian25/*'
```

设计目标：

- 用用户自然记得的仓库片段选择目标。
- 兼容 repo 名、`owner/repo`、`host/owner/repo` 三种心智模型。
- 支持简单 glob，覆盖常见批量选择场景。
- 不引入 pnpm `...` 依赖图语义，因为 `projj` 不维护项目依赖图。

## 移除的旧能力

本次改动移除 `--match` 参数。`--match` 不再作为正则入口保留，也不作为 `--filter` 的别名保留。

旧写法：

```sh
projj run status --all --match '^github\.com/atian25/'
```

新写法：

```sh
projj run status --filter 'github.com/atian25/*'
```

## 本次不做

- 不在第一版提供 `--filter-regex`。
- 不改变 `projj find` 的现有行为。
- 不引入 workspace/package dependency graph。

## 命令形态

更新后的 `run` 语法：

```text
projj run <command-or-task> [--all] [--filter <selector>] [-- ...args]
```

行为：

- 不带 `--all` 且不带 `--filter`：仍然只在当前目录执行命令，忽略 repo 扫描。
- 带 `--all` 且不带 `--filter`：在所有已发现仓库执行命令。
- 带 `--filter <selector>`：先扫描所有仓库，再用 selector 过滤执行目标。
- 同时带 `--all --filter <selector>`：行为与只带 `--filter <selector>` 相同，保留为显式写法。

## Selector 语义

每个仓库有三个可匹配字段：

```text
repo
owner/repo
host/owner/repo
```

例如仓库 key 为：

```text
github.com/atian25/projj
```

匹配字段为：

```text
projj
atian25/projj
github.com/atian25/projj
```

选择器规则：

- 大小写不敏感。
- 不包含 `*` 时，按子串匹配。
- 包含 `*` 时，按 glob 风格完整匹配。
- `*` 可以跨 `/`，第一版不区分 `*` 和 `**`。

示例：

```text
projj                  -> 匹配 github.com/atian25/projj
atian25                -> 匹配 github.com/atian25/projj 和 gitlab.com/atian25/notes
atian25/*              -> 匹配 owner 为 atian25 的 owner/repo 字段
github.com/atian25/*   -> 匹配 github.com/atian25 下的完整 key
GITHUB.COM/EGGJS/*     -> 匹配 github.com/eggjs/egg
```

## 输出和退出码

输出沿用当前 `run --all` 格式：

```text
Running in 1 repositories: git status --short
==> github.com/atian25/projj
$ git status --short
```

如果 `--filter` 没有匹配任何仓库，第一版保持当前 `run --all` 风格：输出 `Running in 0 repositories: ...` 并返回成功。后续如果用户体验上需要更强提醒，可以单独设计 `--strict-filter` 或 warning。

## 兼容性

这是早期 CLI，直接移除 `--match`，避免同时存在 regex 和 selector 两套概念。

如果未来确实需要正则能力，再新增显式高级参数，例如 `--filter-regex`，不复用 `--filter`。

## 测试策略

需要覆盖：

- `--filter projj` 匹配 repo 名。
- `--filter 'atian25/*'` 匹配 `owner/repo`。
- `--filter 'github.com/atian25/*'` 匹配完整 key。
- selector 大小写不敏感。
- `run --filter <selector>` 不要求 `--all`，只在匹配仓库执行。
- `run --all --filter <selector>` 与 `run --filter <selector>` 行为一致。
- CLI help 和 README 不再把 `--match` 作为有效参数展示。
