# Run Changed 设计

## 背景

批量运行命令时，用户经常只关心“有本地变更的仓库”。例如只在 dirty repo 中跑 `status`、`test`、`lint`，或者先快速定位哪些仓库需要处理。

当前 `projj run --filter` 只能按仓库名称选择目标，不能按 git 工作区状态选择目标。`--changed` 的目标是把“只选有改动的仓库”变成 `run` 的一等能力。

## 目标

1. 支持 `projj run <command-or-task> --changed`。
2. `--changed` 可以与 `--filter`、`--all`、`--dry-run` 组合。
3. changed 定义为：在仓库目录执行 `git status --short` 输出非空。
4. 只对扫描到的 repo 生效，不改变当前目录单仓执行语义。
5. changed 检测失败时，该仓库视为失败，最终返回 1。

## 非目标

- 不支持 `--staged`、`--unstaged`、`--untracked` 细分。
- 不支持检测远端 ahead/behind。
- 不支持非 git 目录；`scanRepos` 本身只发现 `.git` 仓库。
- 不为 `find` 增加 `--changed`。
- 不在第一版引入并发检测。

## 命令形态

```bash
projj run status --changed
projj run test --changed
projj run test --filter egg --changed
projj run test --all --changed
projj run test --changed --dry-run
```

`--changed` 是 `run` 子命令的 boolean option。

## 目标选择语义

`--changed` 表示从 repo 集合中进一步过滤 dirty repo。

基础集合：

- 如果传了 `--filter`：先按 filter 选仓库。
- 如果传了 `--all`：使用所有仓库。
- 如果只传 `--changed` 且没有 `--filter` / `--all`：使用所有仓库。

也就是说：

```bash
projj run status --changed
```

等价于：

```bash
projj run status --all --changed
```

这个选择是为了让 `--changed` 本身成为批量选择器，避免要求用户每次写 `--all --changed`。

## Changed 检测

对每个候选仓库执行：

```bash
git status --short
```

语义：

- stdout 非空：changed。
- stdout 为空且 exit 0：not changed。
- exit 非 0：检测失败。

检测失败输出到 stderr：

```text
github.com/atian25/projj: git status failed with exit code 128
```

如果存在检测失败，最终返回 1；未失败的 changed repo 仍可继续执行命令。

## 输出

如果没有 changed repo：

```text
Running in 0 repositories: test
```

返回 0。

如果与 `--dry-run` 组合：

```text
Would run in 2 repositories: test
==> github.com/atian25/projj
$ npm run test
```

如果实际执行：

```text
Running in 2 repositories: test
==> github.com/atian25/projj
$ npm run test
```

## 与 `--filter` 的关系

`--filter` 和 `--changed` 是交集：

```bash
projj run test --filter egg --changed
```

含义是：先找 filter 匹配的 repo，再从中选 changed repo。

如果 filter 没有匹配任何仓库，仍沿用现有行为：

```text
No repositories matched: egg
```

返回 1。

如果 filter 有匹配，但其中没有 changed repo，返回 0。

## 与 hooks 的关系

`--changed` 只决定 `run` 的目标仓库集合。后续如果实现 run lifecycle hooks，hooks 也应只围绕最终目标集合触发。

例如 `pre_run` 不应为被 `--changed` 过滤掉的 clean repo 触发。

## 测试策略

- `run status --changed` 在没有 `--all` 时也扫描所有仓库。
- `--filter` 与 `--changed` 取交集。
- clean repo 不执行命令。
- changed repo 执行命令。
- `--changed --dry-run` 只展示 changed repo，不调用 runner。
- `git status --short` 失败时返回 1，并继续处理其他 repo。

## 自审

- 范围聚焦：只定义 changed selector，不做更细粒度 git 状态。
- 默认行为明确：`--changed` 单独出现时隐式批量扫描所有 repo。
- 与 dry-run/hooks 关系明确：changed 是目标集合过滤器。
