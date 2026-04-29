# Run Dry Run 设计

## 背景

`projj run` 现在会在当前目录、全部仓库或 `--filter` 匹配仓库中执行任务。任务解析已经变成项目感知：同一个 `projj run test --filter ...` 在不同仓库里可能解析成 `npm run test`、`go test ./...`、`.projj.toml` 中的命令，或者全局 task。

这提高了可用性，也带来一个新问题：用户在真正执行前不一定知道每个仓库最终会跑什么。`--dry-run` 的目标是把执行计划显式展示出来，不真正运行命令。

## 目标

1. 支持 `projj run <command-or-task> --dry-run`。
2. 支持与 `--filter`、`--all`、`--` raw command 组合。
3. 复用现有 task resolution，展示每个目标目录最终解析出的命令。
4. 不执行任何 shell command。
5. dry-run 成功解析时返回 0。
6. 解析失败时返回 1，并输出对应错误。

## 非目标

- 不为 `projj run --list` 增加 `--dry-run`，因为 `--list` 本身不执行。
- 不模拟命令退出码。
- 不检查命令是否真实存在。
- 不展开 shell alias。
- 不改变现有 `run` 的默认执行语义。

## 命令形态

```bash
projj run test --dry-run
projj run test --filter egg --dry-run
projj run test --all --dry-run
projj run --dry-run -- ls -a
projj run --filter egg --dry-run -- ls -a
```

`--dry-run` 是 `run` 子命令的 boolean option。

## 当前目录模式

如果没有 `--all` 或 `--filter`，dry-run 只解析当前目录：

```text
Would run in current directory: test
$ npm run test
```

返回 0，不执行命令。

如果命令是 raw command：

```bash
projj run --dry-run -- ls -a
```

输出：

```text
Would run in current directory: ls -a
$ ls -a
```

## 批量模式

如果有 `--all` 或 `--filter`，dry-run 先确定目标仓库，再逐个解析命令：

```text
Would run in 2 repositories: test
==> github.com/eggjs/egg
$ npm run test
==> github.com/eggjs/egg-view
$ npm run test
```

返回 0，不执行命令。

空匹配行为沿用现有 `--filter`：

```text
No repositories matched: nope
```

返回 1。

`--all` 且没有仓库时：

```text
Would run in 0 repositories: test
```

返回 0。

## 输出与颜色

dry-run 输出使用现有结构化输出样式：

- 仓库标题 `==>` 使用 repo header 样式。
- `$ command` 使用 command 样式。
- 空匹配 warning 沿用现有 warning 样式。

dry-run 不打印 `Running in ...`，而打印 `Would run ...`，避免用户误解为已经执行。

## 错误语义

如果某个仓库解析命令时失败，例如 `.projj.toml` 或 `package.json` 无效：

1. 打印 `<repo-key>: <error>`。
2. 继续解析其他仓库。
3. 最终返回 1。

这与 `run --list --filter` 对仓库级解析错误的容忍方式一致。

当前目录模式如果解析失败，直接返回 1。

## 测试策略

- `run test --dry-run` 在当前目录只输出解析命令，不调用 runner。
- `run --filter egg --dry-run` 输出匹配仓库的解析命令，不调用 runner。
- `run --dry-run -- ls -a` 强制 raw command。
- `--filter` 空匹配返回 1。
- 某个仓库 task file 无效时 dry-run 返回 1，并继续列出其他仓库。

## 自审

- 范围聚焦：只做 dry-run，不掺入 changed 或 hooks。
- 语义明确：不执行、不模拟、不检查命令存在性。
- 与现有行为一致：filter 空匹配、仓库级解析错误处理都沿用已有风格。
