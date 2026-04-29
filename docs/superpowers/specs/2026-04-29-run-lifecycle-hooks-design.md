# Run Lifecycle Hooks 设计

## 背景

`post_clone` hooks 解决的是仓库生命周期事件。`projj run` 还需要另一类 hooks：围绕一次批量命令执行的生命周期事件。

典型场景：

- 执行前检查仓库是否满足条件，例如确认没有未提交变更。
- 执行后收集摘要或通知。
- 对某些组织或仓库运行统一准备动作。

这类 hooks 不应该复用 `post_clone` 事件名，而应该有自己的 run lifecycle。

## 目标

1. 支持 `pre_run` 和 `post_run` hooks。
2. hooks 配置继续放在全局 `[[hooks]]`。
3. hook filter 沿用 `run --filter` selector 语义。
4. hook task 复用现有 task resolution。
5. hooks 只围绕最终目标仓库集合触发。
6. 支持与 `--filter`、`--all`、`--changed`、`--dry-run` 的关系清晰可预测。

## 非目标

- 第一版不做全局级 before-all / after-all hook，只做每个 repo 的 hook。
- 第一版不做 hook 级自定义 env。
- 第一版不做 `on_success`、`on_failure` 条件 hook。
- 第一版不做并发。
- 第一版不让普通当前目录模式触发 run lifecycle hooks，除非未来明确需要。

## 配置形态

```toml
[tasks]
ensure-clean = "test -z \"$(git status --short)\""
notify = "echo finished $PROJJ_REPO_OWNER/$PROJJ_REPO_NAME"

[[hooks]]
event = "pre_run"
filter = "github.com/atian25/*"
tasks = ["ensure-clean"]

[[hooks]]
event = "post_run"
filter = "github.com/atian25/*"
tasks = ["notify"]
```

`event` 第一版支持：

- `post_clone`
- `pre_run`
- `post_run`

## 执行顺序

对每个目标 repo，执行顺序为：

```text
pre_run hooks
main run command
post_run hooks
```

如果有多个 hook，按配置顺序执行。每个 hook 内 tasks 按配置顺序执行。

批量模式下整体流程：

```text
repo A: pre_run -> command -> post_run
repo B: pre_run -> command -> post_run
repo C: pre_run -> command -> post_run
```

不做：

```text
all pre_run -> all command -> all post_run
```

这样每个 repo 的上下文完整，失败处理也更直接。

## 失败语义

### pre_run 失败

如果某个 repo 的 `pre_run` hook 失败：

1. 不执行该 repo 的主命令。
2. 不执行该 repo 的 `post_run`。
3. 记录失败摘要。
4. 继续处理后续 repo。

### 主命令失败

如果主命令失败：

1. 仍执行该 repo 的 `post_run`。
2. 记录主命令失败。
3. 继续处理后续 repo。

原因：`post_run` 常用于清理或通知，应有机会知道失败结果。

### post_run 失败

如果 `post_run` 失败：

1. 记录失败摘要。
2. 继续处理后续 repo。

最终 exit code 使用最后一个非 0 code，沿用当前 batch run 行为。

## Dry-run 关系

`--dry-run` 不执行主命令，也不执行 hooks。

但 dry-run 应展示 hooks 会不会参与：

```text
Would run in 1 repository: test
==> github.com/atian25/projj
pre_run hooks: ensure-clean
$ npm run test
post_run hooks: notify
```

这让用户在执行前知道生命周期动作。

## Changed 关系

`--changed` 先过滤最终目标 repo。只有最终目标 repo 才触发 `pre_run` / `post_run`。

clean repo 不触发 hooks。

## 环境变量

run lifecycle hook task 继承 `post_clone` 的 repo context，并新增 run context：

```text
PROJJ_EVENT=pre_run
PROJJ_REPO_PATH=...
PROJJ_REPO_HOST=...
PROJJ_REPO_OWNER=...
PROJJ_REPO_NAME=...
PROJJ_REPO_URL=...
PROJJ_RUN_COMMAND=test
PROJJ_RUN_RESOLVED_COMMAND=npm run test
PROJJ_RUN_EXIT_CODE=0
```

变量可用性：

- `pre_run`：有 `PROJJ_RUN_COMMAND` 和 `PROJJ_RUN_RESOLVED_COMMAND`，没有 `PROJJ_RUN_EXIT_CODE`。
- `post_run`：三者都有。

## 输出

实际执行：

```text
==> github.com/atian25/projj
hook pre_run: ensure-clean
$ test -z "$(git status --short)"
$ npm run test
hook post_run: notify
$ echo finished $PROJJ_REPO_OWNER/$PROJJ_REPO_NAME
```

失败摘要需要区分来源：

```text
Failed in 2 repositories:
- github.com/atian25/projj pre_run ensure-clean exited 1
- github.com/eggjs/egg command exited 127 (command not found)
```

## 测试策略

- `pre_run` 在主命令前执行。
- `pre_run` 失败时跳过主命令和 `post_run`。
- 主命令失败时仍执行 `post_run`。
- `post_run` 失败进入失败摘要。
- `--dry-run` 不执行 hooks，但展示 hooks。
- `--changed` 过滤掉的 clean repo 不触发 hooks。

## 自审

- 范围聚焦：只做 run batch lifecycle hooks，不做全局 before-all/after-all。
- 失败语义明确：pre、command、post 三类失败分别处理。
- 与 dry-run/changed 的关系明确，后续实现可按 feature 顺序推进。
