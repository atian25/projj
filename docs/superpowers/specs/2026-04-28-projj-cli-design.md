# projj CLI 设计

日期：2026-04-28

## 目标

用 TypeScript + Bun 实现一个新的本地 `projj` CLI。它用稳定的本地目录规范管理远程 git 仓库，并提供轻量的 shell 集成。

第一版聚焦在 clone、查找、跳转、跨仓库运行命令。文件系统目录结构就是唯一事实来源。

## 目录规范

仓库 clone 到确定性的本地路径：

```text
$base/<host>/<owner>/<repo>
```

例如：

```text
~/projj/github.com/atian25/projj
~/projj/github.com/eggjs/egg
```

shell 集成通过 finalizer 文件完成。CLI 可以请求当前 shell 执行动作，比如切换目录，而不需要 shell wrapper 理解每一个具体命令。

## 命令

第一版有五个用户可见命令：

```text
projj init
projj clone <repo> [--base <path>] [--cd]
projj find [搜索词] [--list]
projj run <命令或任务> [--all] [--match <regex>] [-- ...args]
projj shell-init <zsh|bash|fish>
```

### `projj init`

如果配置目录和配置文件不存在，就创建：

```text
~/.projj/config.toml
```

默认配置：

```toml
base = ["~/projj"]
platform = "github.com"

[tasks]
status = "git status --short"
pull = "git pull --ff-only"
fetch = "git fetch --all --prune"
```

`init` 不覆盖已有配置。以后如果需要，可以再加显式覆盖参数。

### `projj clone <repo> [--base <path>] [--cd]`

把远程 git 仓库 clone 到规范目录结构中。

支持输入：

```text
atian25/projj
eggjs/egg
https://github.com/eggjs/egg.git
git@github.com:atian25/projj.git
```

短写 `owner/repo` 使用配置里的 `platform`。目标路径是：

```text
<base>/<host>/<owner>/<repo>
```

如果配置了多个 base，`clone` 默认使用第一个 base。`--base <path>` 可以为本次 clone 指定 base。

如果目标路径已经存在，不重复 clone。命令报告已有路径并成功退出。

`--cd` 表示 clone 成功后跳转到目标路径。如果路径已经存在，也跳转到已有路径。这个跳转通过 finalizer 机制完成，所以只有加载了 shell 集成时才会改变当前 shell 的目录。没有 shell 集成时，命令打印目标路径，并提示如何启用 shell 集成。

### `projj find [搜索词] [--list]`

通过扫描配置里的 base 目录查找仓库，扫描固定三层：

```text
base/host/owner/repo/.git
```

这样结果始终和真实文件系统一致。

默认行为是跳转：

- 没有搜索词：展示全部仓库选择器，选中后跳转。
- 一个匹配：直接跳转到该仓库。
- 多个匹配：展示选择器，选中后跳转。

`--list` 改为只列出结果。它按行打印匹配仓库的绝对路径，不改变目录。stdout 不输出额外提示，方便脚本消费。

搜索大小写不敏感，匹配以下字段：

- repo 名
- `owner/repo`
- `host/owner/repo`

排序优先级：

1. repo 名精确匹配
2. `owner/repo` 精确匹配
3. `host/owner/repo` 精确匹配
4. 子串匹配
5. 同优先级内按路径排序

交互选择优先使用 `fzf`，前提是 `fzf` 可用且 stdin/stdout 是 TTY。如果没有 `fzf`，回退到简单的编号选择。

如果没有加载 shell 集成，而默认行为需要跳转，`find` 打印选中的路径，并提示如何启用 shell 集成。`--list` 必须保持脚本友好，不在 stdout 输出额外提示。

### `projj run <命令或任务> [--all] [--match <regex>] [-- ...args]`

运行配置任务或原始 shell 命令。

解析顺序：

1. 如果 `<命令或任务>` 命中配置里的 `[tasks]`，运行对应命令。
2. 否则把 `<命令或任务>` 当作原始 shell 命令运行。

不带 `--all` 时，命令在当前工作目录运行。

带 `--all` 时，扫描全部仓库，并在每个仓库路径下运行命令。`--match <regex>` 用 `host/owner/repo` 过滤仓库。

`--` 后面的参数追加到解析后的命令后面。

### `projj shell-init <zsh|bash|fish>`

输出指定 shell 的集成代码。

wrapper 保持很薄，只负责：

1. 创建临时 finalizer 文件。
2. 设置 `PROJJ_FINALIZER_FILE` 并运行真正的 `projj` 二进制。
3. 读取 finalizer 动作。
4. 执行支持的 shell 动作。
5. 删除临时文件。
6. 返回原命令的退出码。

第一版只支持一种 finalizer 动作：

```text
cd:/absolute/path
```

以后如果要支持设置环境变量等动作，可以在不增加命令级 wrapper 特判的情况下扩展。

## 配置

配置路径：

```text
~/.projj/config.toml
```

配置格式：

```toml
base = ["~/projj"]
platform = "github.com"

[tasks]
status = "git status --short"
pull = "git pull --ff-only"
fetch = "git fetch --all --prune"
```

规则：

- `base` 是目录路径数组。
- `platform` 是短写 clone 输入的默认 host。
- `[tasks]` 把任务名映射到 shell 命令字符串。
- `~` 展开为用户 home 目录。
- 配置里的相对路径相对于 `~/.projj` 解析。
- `~/.projj/tasks/` 任务文件推迟实现。第一版只支持配置里的 `[tasks]`。

## 架构

建议模块结构：

```text
src/cli.ts
src/config.ts
src/git-url.ts
src/repos.ts
src/select.ts
src/git.ts
src/run.ts
src/shell.ts
src/output.ts
```

职责：

- `cli.ts`：子命令路由，以及用 Node `util.parseArgs` 做参数解析。
- `config.ts`：配置路径、默认值、加载、写入、路径展开。
- `git-url.ts`：解析仓库输入，计算 host、owner、repo、clone URL 和相对路径。
- `repos.ts`：固定深度扫描、匹配、排序。
- `select.ts`：检测 `fzf`，以及 fallback 选择器。
- `git.ts`：执行 clone。
- `run.ts`：解析任务，并在单个或多个仓库里执行命令。
- `shell.ts`：生成 shell-init 输出，写入 finalizer。
- `output.ts`：用户可读的简洁输出和错误信息。

## CLI 解析

使用 Node 内置的 `node:util.parseArgs`，不引入外部 CLI 框架。命令数量少，小型子命令 router 足够，依赖面也更小。

开发阶段用 Bun 直接运行 TypeScript 入口。后续打包时再把入口包装成可执行命令。

短写 clone 默认使用 SSH：

```text
git@<platform>:<owner>/<repo>.git
```

## 测试策略

使用 `bun test`。

核心测试：

- 解析仓库输入：短写、HTTPS、scp-like SSH、带端口的 `ssh://`、移除 `.git` 后缀。
- 根据配置 base 和仓库信息计算 clone 路径。
- 固定三层扫描，并忽略隐藏目录或非 git 目录。
- 大小写不敏感地做精确匹配和子串匹配。
- 按定义好的优先级排序匹配结果。
- 加载默认配置并展开 `~`。
- 只有设置 `PROJJ_FINALIZER_FILE` 时才写入 `cd:` finalizer 动作。
- `run` 先解析任务名，再回退到原始 shell 命令。
- `run --all` 使用 `--match` 过滤仓库。
