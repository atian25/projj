# Hooks Run 设计

## 背景

`post_clone` hooks 第一版只在新 clone 成功后触发。这个语义安全，但用户有时需要手动补跑 hooks：

- 仓库已经存在，想补跑 `post_clone` setup。
- 修改了 hook 配置，想对一批仓库重新应用。
- 调试 hook task。

`projj hooks run` 提供手动运行 hooks 的入口，不改变 `projj clone` 的安全默认行为。

## 目标

1. 新增 `projj hooks run <event>`。
2. 第一版支持手动运行 `post_clone` hooks。
3. 支持 `--filter <selector>` 选择仓库。
4. 支持 `--all` 对所有仓库运行。
5. 支持 `--dry-run` 展示会运行哪些 hooks/tasks，不执行。
6. 复用现有 hooks 选择、task resolution、输出和失败摘要。

## 非目标

- 不改变 `projj clone` 的已存在仓库行为。
- 不支持直接运行未配置的任意 task；那是 `projj run` 的职责。
- 不支持 `pre_run` / `post_run` 的手动运行，除非 run lifecycle hooks 已实现并确认需要。
- 不做交互式选择器，第一版只支持 `--filter` / `--all`。

## 命令形态

```bash
projj hooks run post_clone --filter atian25/projj
projj hooks run post_clone --filter 'github.com/atian25/*'
projj hooks run post_clone --all
projj hooks run post_clone --filter atian25/projj --dry-run
```

必须传 `--filter` 或 `--all`。如果都不传，返回 1：

```text
Usage: projj hooks run <event> [--all] [--filter <selector>] [--dry-run]
```

这样避免用户误操作所有仓库。

## Event 支持

第一版只支持：

```text
post_clone
```

如果传未知 event：

```text
unsupported hook event: pre_run
```

返回 1。

后续实现 run lifecycle hooks 后，可以再决定是否允许手动运行 `pre_run` / `post_run`。

## Repo Context

手动运行 `post_clone` hooks 时，repo context 来自扫描到的本地仓库：

```text
PROJJ_EVENT=post_clone
PROJJ_REPO_PATH=/Users/tz/projj/github.com/atian25/projj
PROJJ_REPO_HOST=github.com
PROJJ_REPO_OWNER=atian25
PROJJ_REPO_NAME=projj
PROJJ_REPO_URL=git@github.com:atian25/projj.git
```

`PROJJ_REPO_URL` 使用当前 repo 的默认 SSH URL 形式拼出：

```text
git@<host>:<owner>/<repo>.git
```

原因：本地扫描结果不保存原始 clone URL。第一版保持可预测即可。

## 输出

实际执行：

```text
Running post_clone hooks in 1 repository
==> github.com/atian25/projj
hook post_clone: setup-git-user
$ git config user.email me@example.com
```

dry-run：

```text
Would run post_clone hooks in 1 repository
==> github.com/atian25/projj
hook post_clone: setup-git-user
$ git config user.email me@example.com
```

如果某个 repo 没有匹配的 hook：

```text
Running post_clone hooks in 1 repository
==> github.com/atian25/projj
No matching hooks.
```

返回 0。

## 失败语义

每个 repo 内沿用 hook 执行器语义：某个 task 失败时停止该 repo 后续 hooks/tasks。

批量时继续处理后续 repo，并最终输出摘要：

```text
Failed in 1 repository:
- github.com/atian25/projj post_clone setup-git-user exited 1
```

最终 exit code 使用最后一个非 0 code，沿用 `projj run` batch 行为。

## 与 `--dry-run` 的关系

`--dry-run`：

- 扫描 repo。
- 选择匹配 hooks。
- 解析每个 hook task 的最终命令。
- 不执行 shell command。
- 如果解析配置失败，返回 1。

## 测试策略

- 不传 `--filter` / `--all` 返回 usage。
- unknown event 返回 1。
- `post_clone --filter` 只对匹配 repo 运行。
- `post_clone --all` 对所有 repo 运行。
- 没有匹配 hooks 时返回 0。
- `--dry-run` 展示 hook task，不调用 runner。
- 单个 repo hook 失败时继续后续 repo，并输出失败摘要。

## 自审

- 范围明确：只做手动运行已配置 hooks，不替代 `projj run`。
- 安全默认：必须显式 `--filter` 或 `--all`。
- 与 clone 语义不冲突：不会让已存在仓库自动触发 hooks，只提供手动入口。
