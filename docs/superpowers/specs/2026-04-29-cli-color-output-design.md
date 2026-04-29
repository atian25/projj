# CLI 彩色结构化输出设计

## 背景

`projj run` 现在会输出两类内容：

- `projj` 自己生成的结构化提示，例如 `Running in ...`、`==> repo`、`$ command`、失败汇总。
- 被执行命令的原始 stdout/stderr，例如 `npm test`、`eslint`、`git status` 的输出。

用户反馈当前命令输出“感觉没有颜色”。这个需求的目标不是改写子命令输出，而是让 `projj` 自己的提示更容易扫读：仓库边界、执行命令、失败汇总、常见 exit code 解释要更醒目。

## 目标

1. 为 `projj` 自己的结构化输出加颜色。
2. 保持被执行命令的 stdout/stderr 原样透传，不包裹、不解析、不重新着色。
3. 不新增第三方依赖，优先使用 Node/Bun 已支持的 `node:util styleText`。
4. 默认只在适合显示颜色的终端里输出 ANSI；非 TTY、测试捕获、`NO_COLOR` 时保持纯文本。
5. 支持 `FORCE_COLOR`，方便用户在管道、日志或调试场景里强制打开颜色。

## 非目标

- 不在第一版增加 `--color=always|auto|never` CLI 参数。
- 不检测或加载用户交互式 shell，因此不会让 `ll` 这类 alias 自动可用。
- 不解析子命令 stderr 来提取错误原因。失败摘要只使用 exit code 和内置解释。
- 不引入 chalk、yoctocolors 或 picocolors 依赖。

## 方案选项

### 方案 A：直接在 `src/cli.ts` 调用 `styleText`

优点是改动最少。缺点是颜色策略、环境变量处理和样式散落在 CLI 流程里，后续测试或复用会变脆。

### 方案 B：新增一个小型颜色封装

新增 `src/color.ts`，集中处理：

- 是否启用颜色。
- `styleText` 调用。
- `projj` 当前需要的语义化样式，例如 `repoHeader`、`command`、`failureTitle`。

`src/cli.ts` 只使用语义化方法，不关心具体 ANSI 样式。

这是推荐方案。它不引入依赖，代码边界清楚，也方便测试。

### 方案 C：引入轻量颜色库

例如 yoctocolors/picocolors。它们 API 简洁、生态成熟，但本项目目前依赖很少，而运行时已经有 `styleText`，为了这个小功能新增依赖收益不够。

## 选定设计

采用方案 B。

新增 `src/color.ts`：

- `shouldUseColor(env, isTty)`：根据环境和终端能力判断是否默认启用颜色。
- `createColorTheme(enabled)`：返回一组语义化格式化函数。`enabled=false` 时所有函数原样返回文本。

颜色语义：

- 仓库标题 `==> github.com/...`：`cyan` + `bold`。
- 即将执行的命令 `$ npm run test`：`dim`。
- 失败汇总标题 `Failed in N repositories:`：`red` + `bold`。
- 常见 exit code 解释 `(command not found)`：`yellow`。
- 空匹配提示 `No repositories matched: ...`：`yellow`。
- `run --list` 的标题和仓库标题：标题使用 `bold`，仓库标题沿用 `cyan` + `bold`。
- 任务来源标题如 `package.json`、`global (...)`：`bold`。

`projj run` 的子命令输出保持现在的执行方式，不经过颜色封装。

## 环境变量策略

`shouldUseColor(env, isTty)` 使用以下优先级：

1. `NO_COLOR` 存在时禁用颜色。
2. `NODE_DISABLE_COLORS` 存在时禁用颜色。
3. `FORCE_COLOR` 存在且不是 `0` 时启用颜色。
4. 否则使用 `isTty`。

测试中可以通过 `CliDeps.color` 显式开启或关闭颜色，避免依赖测试进程是否是 TTY。

## 测试策略

1. 新增 `test/color.test.ts`：
   - `enabled=false` 时返回纯文本。
   - `enabled=true` 时包含 ANSI escape。
   - `NO_COLOR` 覆盖 TTY。
   - `FORCE_COLOR=1` 覆盖非 TTY。
2. 扩展 CLI 测试：
   - `color: true` 时 `run --filter` 的结构化 stdout 包含 ANSI，且命令本身调用参数不变。
   - `color: true` 时失败摘要标题和 exit code 解释带颜色。
3. 保持现有 CLI 测试期望为纯文本，防止非交互环境的输出快照被 ANSI 污染。

## 自审

- 无占位项：本文没有 TBD/TODO。
- 一致性：设计只触及 `projj` 结构化输出，不改变子命令执行和透传。
- 范围：单一功能，适合一个实现计划。
- 歧义：第一版不提供 `--color` 参数，明确通过自动检测和环境变量控制。
