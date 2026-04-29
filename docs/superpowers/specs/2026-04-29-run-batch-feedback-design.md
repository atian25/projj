# run 批量执行反馈设计

日期：2026-04-29

## 背景

`projj run --all` 和 `projj run --filter` 会在多个 repo 中执行命令。当前行为是逐个输出原始命令日志，并把最终退出码设置为最后一个非 0 code。

这个行为保留了原始日志，但批量场景下用户不容易在长输出里看清哪些 repo 失败。同时，`--filter` 匹配 0 个 repo 时当前返回 0，脚本和人都会容易误判为“成功执行”。

## 目标

本次改动只优化批量执行反馈：

- `--all` / `--filter` 执行后，如果有失败 repo，输出失败汇总。
- `--filter <selector>` 匹配 0 个 repo 时返回非 0。
- `--all` 在没有 repo 时仍返回 0，表示“全部集合为空但命令语义有效”。
- 不改变单 repo 当前目录执行行为。
- 不改变命令原始 stdout/stderr 透传行为。

## 命令行为

### 失败汇总

批量执行时，`projj` 仍然逐个 repo 执行命令：

```text
Running in 2 repositories: test
==> github.com/eggjs/egg-view
$ npm run test
...
==> github.com/atian25/projj
$ bun test
...
```

如果存在失败，结尾追加：

```text
Failed in 1 repository:
- github.com/eggjs/egg-view exited 127
```

多个失败：

```text
Failed in 2 repositories:
- github.com/eggjs/egg-view exited 127
- github.com/foo/bar exited 1
```

失败汇总输出到 stderr。最终退出码仍沿用当前策略：返回最后一个非 0 code。

### 空匹配

如果用户显式传了 `--filter <selector>`，但没有匹配任何 repo：

```sh
projj run test --filter nope
```

输出：

```text
No repositories matched: nope
```

返回 1。

如果是：

```sh
projj run test --all
```

且配置 base 中没有 repo，保留现有风格：

```text
Running in 0 repositories: test
```

返回 0。

`projj run --list --filter nope` 也应使用相同空匹配语义，输出 `No repositories matched: nope` 并返回 1。`projj run --list --all` 在 0 repo 时返回 0。

## 非目标

- 不新增并发执行。
- 不新增失败重试。
- 不改变多 repo 遍历完所有 repo 的行为。
- 不把原始命令 stdout/stderr 捕获后重排。
- 不新增 JSON 输出。

## 测试策略

需要覆盖：

- `run --filter <selector>` 空匹配返回 1，并输出 no match。
- `run --all` 空 repo 返回 0。
- `run --list --filter <selector>` 空匹配返回 1。
- 多 repo 执行时失败 repo 汇总到 stderr。
- 多 repo 有失败时仍继续执行后续 repo。
- 多 repo 最终退出码为最后一个非 0 code。
