# Post Clone Hooks 设计

## 背景

`projj` 当前已经解决了三个基础问题：

- `clone` 把仓库放到稳定路径：`$base/<host>/<owner>/<repo>`。
- `find` 能按目录结构快速定位仓库。
- `run` 能在当前目录或一组仓库内解析并执行任务，任务来源包括项目本身和全局配置。

但 `clone` 成功之后，用户仍然需要手动做一批重复动作，例如配置仓库级 git user、注册 zoxide、执行项目初始化脚本，或者把新仓库接入个人工作流。`popomore/projj` 的 hooks 设计说明这个问题属于 repo manager 的主线能力，而不是 `run` 的边角体验。

第一版 hooks 聚焦在 `post_clone`：只处理“新仓库成功 clone 后自动执行任务”。

## 目标

1. 支持在全局配置中声明 `post_clone` hooks。
2. hook 只在本次 `projj clone` 真正执行并成功完成 git clone 后触发。
3. 目标路径已存在时不触发 hook。
4. hook 使用现有 task resolution：任务名可以来自项目 `.projj.toml`、项目生态文件、全局 `[tasks]`，也可以 fallback 成 raw command。
5. hook 支持按仓库 selector 过滤，过滤逻辑沿用 `projj run --filter`。
6. hook task 执行时注入 repo 上下文环境变量，方便脚本复用。
7. hook 失败时 `clone` 返回非 0，不回滚已经 clone 成功的仓库。

## 非目标

- 第一版不做 `pre_clone`、`pre_remove`、`post_remove`。
- 第一版不做 `projj hooks list` 或 `projj hooks run`。
- 第一版不做 `--no-hooks`。如果配置损坏，用户可以临时改配置；是否需要运行时关闭开关留给后续真实反馈。
- 第一版不支持 hook 级自定义 `env = { ... }`。
- 第一版不支持 regex matcher；使用 selector/filter，避免同时存在两套匹配语言。
- 第一版不引入内置 hook task，例如 `zoxide` 或 `git-config-user`。用户可以先用 `[tasks]` 自己定义。

## 配置形态

全局配置文件 `~/.projj/config.toml` 新增 `[[hooks]]`：

```toml
[tasks]
setup-git-user = "git config user.email me@example.com"
zoxide = "zoxide add ."

[[hooks]]
event = "post_clone"
filter = "github.com/atian25/*"
tasks = ["setup-git-user", "zoxide"]
```

字段含义：

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `event` | 是 | 第一版只接受 `"post_clone"` |
| `tasks` | 是 | 按顺序执行的任务名或 raw command |
| `filter` | 否 | 仓库 selector；省略时匹配所有仓库 |

配置校验：

- `hooks` 必须是数组。
- 每个 hook 必须是对象。
- `event` 必须是字符串，且第一版只能是 `post_clone`。
- `tasks` 必须是非空字符串数组。
- `filter` 如果存在，必须是字符串。

## Selector 语义

`filter` 沿用 `projj run --filter` 的 selector 逻辑，匹配仓库的：

- repo name：`egg-view`
- owner/repo：`eggjs/*`
- host/owner/repo：`github.com/eggjs/*`

`*` 通配符按当前 `filterReposBySelector` 行为处理。第一版不支持 regex matcher。

## 执行时机

`projj clone <repo>` 的流程变为：

1. 解析配置和 repo 输入。
2. 计算目标路径。
3. 如果目标路径已存在：
   - 输出 `exists <path>`。
   - 不触发 hooks。
   - 继续执行原有 auto-cd 行为。
4. 如果目标路径不存在：
   - 执行 git clone。
   - clone 成功后输出 `cloned <path>`。
   - 执行匹配的 `post_clone` hooks。
   - hooks 完成后继续执行原有 auto-cd 行为。

hook 在 auto-cd/finalizer 之前执行，因为 hook task 的 cwd 明确是新 clone 的 repo path，不依赖 shell 当前目录是否真的发生变化。

## Task Resolution

hook task 复用 `resolveRunCommand(task, [], config.tasks, repoPath)`。

这意味着第一版中，hook task 的解析优先级与 `projj run` 一致：

1. 新仓库内 `.projj.toml` 的 `[tasks]`。
2. 新仓库内的项目任务，例如 `package.json` scripts、Makefile、justfile、Taskfile、Cargo、Go。
3. 全局 `~/.projj/config.toml` 的 `[tasks]`。
4. raw command fallback。

hook task 第一版不支持额外参数；如果需要参数，用户直接在 `[tasks]` 命令字符串里写完整命令。

## 输出

hook 输出应该和 `projj run` 的结构化输出保持同一种风格，但更简短：

```text
cloned /Users/tz/projj/github.com/atian25/projj
hook post_clone: setup-git-user
$ git config user.email me@example.com
hook post_clone: zoxide
$ zoxide add .
```

其中：

- `hook post_clone: <task>` 是 `projj` 自己的结构化输出。
- `$ <resolved command>` 显示最终解析后的命令。
- task 自己的 stdout/stderr 原样透传。
- 彩色输出复用现有 `src/color.ts` 主题。

## 失败语义

如果某个 hook task 返回非 0：

1. 停止当前 hook 的后续 tasks。
2. 停止后续 hooks。
3. 输出失败摘要。
4. `projj clone` 返回该 task 的 exit code。
5. 不回滚已经 clone 成功的仓库。
6. 不执行 auto-cd/finalizer。

示例：

```text
cloned /Users/tz/projj/github.com/atian25/projj
hook post_clone: setup-git-user
$ git config user.email me@example.com
hook post_clone failed: setup-git-user exited 1
```

不回滚的原因：clone 成功和 setup 失败是两个事实。自动删除已 clone 仓库风险更高，也可能误删用户已经在 hook 过程中生成的内容。

## 环境变量

hook task 执行时注入：

```text
PROJJ_EVENT=post_clone
PROJJ_REPO_PATH=/Users/tz/projj/github.com/atian25/projj
PROJJ_REPO_HOST=github.com
PROJJ_REPO_OWNER=atian25
PROJJ_REPO_NAME=projj
PROJJ_REPO_URL=git@github.com:atian25/projj.git
```

这些变量只对 hook task 生效，不改变普通 `projj run` 的环境。

## 代码边界

新增 `src/hooks.ts`：

- 负责 hook 类型定义。
- 负责按 event 和 filter 选择 hooks。
- 负责按顺序解析和执行 hook tasks。
- 对外暴露可测试的纯函数和执行入口。

扩展 `src/config.ts`：

- `ProjjConfig` 增加 `hooks`。
- `defaultConfig()` 默认 `hooks: []`。
- `loadConfig()` 校验并加载 `[[hooks]]`。

扩展 `src/run.ts` 或新增执行参数：

- hook task 需要在运行 shell command 时传入额外 env。
- 普通 `projj run` 行为保持不变。

扩展 `src/cli.ts`：

- `clone` 成功后调用 hook 执行入口。
- `exists` 分支不调用 hooks。
- hook 失败时返回非 0，并跳过 auto-cd。

## 测试策略

配置测试：

- 默认配置包含 `hooks: []`。
- 合法 `[[hooks]]` 能被加载。
- 非数组 hooks、非字符串 event、未知 event、空 tasks、非字符串 filter 都报清晰错误。

hook 选择测试：

- 无 filter 匹配所有 repo。
- `filter = "egg-view"` 匹配 repo name。
- `filter = "eggjs/*"` 匹配 owner/repo。
- `filter = "github.com/eggjs/*"` 匹配 host/owner/repo。

hook 执行测试：

- 按 hook 顺序、task 顺序执行。
- task 使用 repo path 作为 cwd。
- task 注入 `PROJJ_*` 环境变量。
- task resolution 复用项目/全局优先级。
- 第一个失败 task 会停止后续 task 和 hook，并返回该 exit code。

CLI 测试：

- 新 clone 成功后触发匹配 hook。
- 目标路径已存在时不触发 hook。
- hook 失败时 `clone` 返回非 0，且不写 finalizer。
- `--no-cd` 只关闭 auto-cd，不关闭 hooks。

## 自审

- 占位扫描：本文没有未完成占位。
- 一致性：配置字段使用 `filter`，全文没有混用 `matcher` 作为第一版配置。
- 范围检查：只覆盖 `post_clone`，是单一可实现功能，不需要拆成多个 spec。
- 歧义处理：明确了已存在仓库不触发、hook 失败不回滚、失败后不 auto-cd、第一版不支持 `--no-hooks`。
