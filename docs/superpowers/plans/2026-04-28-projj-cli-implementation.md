# projj CLI 实现计划

> **给执行 Agent 的要求：** 实现本计划时，必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。按任务逐项执行，使用复选框跟踪进度。

**目标：** 实现第一版 TypeScript + Bun 的 `projj` CLI，支持初始化配置、按 `$base/<host>/<owner>/<repo>` clone 仓库、查找并跳转仓库、跨仓库运行命令、生成 shell 集成代码。

**架构：** 代码拆成 `src/` 下的小模块。仓库发现只扫描配置中的 base 目录，固定三层目录结构，不维护额外索引。需要改变当前 shell 的动作通过 finalizer 文件传递，shell wrapper 保持简单。

**技术栈：** Bun、TypeScript、Node 内置模块（`node:util`、`node:path`、`node:fs/promises`、`node:child_process`）、`smol-toml`、`bun test`。

---

## 文件结构

- 新建 `package.json`：项目脚本、bin 入口、依赖。
- 新建 `tsconfig.json`：严格 TypeScript 配置。
- 新建 `src/index.ts`：可执行入口。
- 新建 `src/cli.ts`：命令路由和 `parseArgs` 参数解析。
- 新建 `src/config.ts`：配置默认值、加载、写入、路径展开。
- 新建 `src/git-url.ts`：解析仓库输入，生成 clone 元数据。
- 新建 `src/repos.ts`：固定深度扫描、匹配、排序。
- 新建 `src/select.ts`：`fzf` 选择和编号 fallback。
- 新建 `src/git.ts`：clone 执行和目标路径处理。
- 新建 `src/run.ts`：任务或原始命令解析与执行。
- 新建 `src/shell.ts`：生成 shell-init 输出，写入 finalizer。
- 新建 `src/output.ts`：用户可读输出和错误格式化。
- 新建 `test/*.test.ts`：各模块单元测试。

## 任务 1：项目骨架

**文件：**
- 新建：`package.json`
- 新建：`tsconfig.json`
- 新建：`src/index.ts`
- 新建：`src/cli.ts`
- 新建：`src/output.ts`
- 测试：`test/cli.test.ts`

- [ ] **步骤 1：写失败的 CLI 冒烟测试**

新建 `test/cli.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { createCli } from "../src/cli";

describe("cli", () => {
  test("prints help for --help", async () => {
    const writes: string[] = [];
    const cli = createCli({
      stdout: (text) => writes.push(text),
      stderr: (text) => writes.push(text),
    });

    const code = await cli.run(["--help"]);

    expect(code).toBe(0);
    expect(writes.join("")).toContain("projj init");
    expect(writes.join("")).toContain("projj clone <repo>");
    expect(writes.join("")).toContain("projj find [搜索词]");
  });
});
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`bun test test/cli.test.ts`

预期：失败，因为 `src/cli.ts` 还不存在。

- [ ] **步骤 3：添加项目配置**

新建 `package.json`：

```json
{
  "name": "projj",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "projj": "./src/index.ts"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  },
  "dependencies": {
    "smol-toml": "^1.4.2"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "latest"
  }
}
```

新建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "types": ["bun-types"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **步骤 4：实现最小 CLI 路由**

新建 `src/output.ts`：

```ts
export type Output = {
  stdout(text: string): void;
  stderr(text: string): void;
};

export const consoleOutput: Output = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
```

新建 `src/cli.ts`：

```ts
import { parseArgs } from "node:util";
import type { Output } from "./output";
import { formatError } from "./output";

export type CliDeps = {
  stdout: Output["stdout"];
  stderr: Output["stderr"];
};

const HELP = `projj

Usage:
  projj init
  projj clone <repo> [--base <path>] [--cd]
  projj find [搜索词] [--list]
  projj run <命令或任务> [--all] [--match <regex>] [-- ...args]
  projj shell-init <zsh|bash|fish>
`;

export function createCli(deps: CliDeps) {
  const output: Output = {
    stdout: deps.stdout,
    stderr: deps.stderr,
  };

  return {
    async run(argv: string[]): Promise<number> {
      try {
        if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
          output.stdout(HELP);
          return 0;
        }

        const command = argv[0];
        const rest = argv.slice(1);

        switch (command) {
          case "init":
          case "clone":
          case "find":
          case "run":
          case "shell-init":
            parseArgs({ args: rest, options: {}, allowPositionals: true });
            output.stderr(`command not implemented yet: ${command}\n`);
            return 1;
          default:
            output.stderr(`unknown command: ${command}\n`);
            return 1;
        }
      } catch (error) {
        output.stderr(`${formatError(error)}\n`);
        return 1;
      }
    },
  };
}
```

新建 `src/index.ts`：

```ts
#!/usr/bin/env bun
import { createCli } from "./cli";
import { consoleOutput } from "./output";

const cli = createCli(consoleOutput);
const code = await cli.run(process.argv.slice(2));
process.exit(code);
```

- [ ] **步骤 5：运行测试和类型检查**

运行：`bun install`

预期：依赖安装成功，并生成 `bun.lock`。

运行：`bun test test/cli.test.ts`

预期：通过。

运行：`bun run typecheck`

预期：通过。

- [ ] **步骤 6：提交**

```bash
git add package.json bun.lock tsconfig.json src/index.ts src/cli.ts src/output.ts test/cli.test.ts
git commit -m "chore: scaffold bun cli"
```

## 任务 2：配置模块和 `init`

**文件：**
- 修改：`src/cli.ts`
- 新建：`src/config.ts`
- 测试：`test/config.test.ts`
- 修改：`test/cli.test.ts`

- [ ] **步骤 1：写配置测试**

新建 `test/config.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  defaultConfig,
  expandConfigPath,
  loadConfig,
  saveDefaultConfig,
} from "../src/config";

describe("config", () => {
  test("default config uses ~/.projj style values", () => {
    expect(defaultConfig()).toEqual({
      base: ["~/projj"],
      platform: "github.com",
      tasks: {
        status: "git status --short",
        pull: "git pull --ff-only",
        fetch: "git fetch --all --prune",
      },
    });
  });

  test("expands tilde and relative paths", () => {
    const home = "/Users/example";
    const configDir = join(home, ".projj");

    expect(expandConfigPath("~/projj", home, configDir)).toBe(join(home, "projj"));
    expect(expandConfigPath("repos", home, configDir)).toBe(join(configDir, "repos"));
    expect(expandConfigPath("/tmp/repos", home, configDir)).toBe("/tmp/repos");
  });

  test("saves and loads default config", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const root = dir.trim();
    const configPath = join(root, ".projj", "config.toml");

    await saveDefaultConfig(configPath);
    const config = await loadConfig(configPath, root);

    expect(config.platform).toBe("github.com");
    expect(config.base).toEqual([join(root, "projj")]);
    expect(config.tasks.status).toBe("git status --short");
  });
});
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`bun test test/config.test.ts`

预期：失败，因为 `src/config.ts` 还不存在。

- [ ] **步骤 3：实现配置模块**

新建 `src/config.ts`：

```ts
import { dirname, isAbsolute, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse, stringify } from "smol-toml";

export type ProjjConfig = {
  base: string[];
  platform: string;
  tasks: Record<string, string>;
};

export function defaultConfig(): ProjjConfig {
  return {
    base: ["~/projj"],
    platform: "github.com",
    tasks: {
      status: "git status --short",
      pull: "git pull --ff-only",
      fetch: "git fetch --all --prune",
    },
  };
}

export function defaultConfigPath(home = process.env.HOME ?? "."): string {
  return join(home, ".projj", "config.toml");
}

export function expandConfigPath(value: string, home: string, configDir: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  if (isAbsolute(value)) return value;
  return join(configDir, value);
}

function normalizeParsedConfig(value: unknown): ProjjConfig {
  const record = value as Partial<ProjjConfig>;
  const defaults = defaultConfig();
  const base = Array.isArray(record.base)
    ? record.base.map(String)
    : typeof record.base === "string"
      ? [record.base]
      : defaults.base;
  const platform = typeof record.platform === "string" ? record.platform : defaults.platform;
  const tasks =
    record.tasks && typeof record.tasks === "object" && !Array.isArray(record.tasks)
      ? Object.fromEntries(Object.entries(record.tasks).map(([key, val]) => [key, String(val)]))
      : defaults.tasks;
  return { base, platform, tasks };
}

export async function loadConfig(
  configPath = defaultConfigPath(),
  home = process.env.HOME ?? ".",
): Promise<ProjjConfig> {
  const configDir = dirname(configPath);
  const raw = await readFile(configPath, "utf8");
  const parsed = normalizeParsedConfig(parse(raw));
  return {
    ...parsed,
    base: parsed.base.map((path) => expandConfigPath(path, home, configDir)),
  };
}

export async function saveDefaultConfig(configPath = defaultConfigPath()): Promise<boolean> {
  try {
    await readFile(configPath, "utf8");
    return false;
  } catch {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, stringify(defaultConfig()), "utf8");
    return true;
  }
}
```

- [ ] **步骤 4：接入 `projj init`**

修改 `src/cli.ts` 的 import：

```ts
import { parseArgs } from "node:util";
import { defaultConfigPath, saveDefaultConfig } from "./config";
import type { Output } from "./output";
import { formatError } from "./output";
```

替换 `"init"` 分支：

```ts
case "init": {
  parseArgs({ args: rest, options: {}, allowPositionals: false });
  const path = defaultConfigPath();
  const created = await saveDefaultConfig(path);
  output.stdout(created ? `created ${path}\n` : `exists ${path}\n`);
  return 0;
}
```

- [ ] **步骤 5：补充未知命令测试**

在 `test/cli.test.ts` 添加：

```ts
test("unknown command returns 1", async () => {
  const writes: string[] = [];
  const cli = createCli({
    stdout: (text) => writes.push(text),
    stderr: (text) => writes.push(text),
  });

  const code = await cli.run(["nope"]);

  expect(code).toBe(1);
  expect(writes.join("")).toContain("unknown command: nope");
});
```

- [ ] **步骤 6：运行测试并提交**

运行：`bun test test/config.test.ts test/cli.test.ts`

预期：通过。

运行：`bun run typecheck`

预期：通过。

```bash
git add src/cli.ts src/config.ts test/config.test.ts test/cli.test.ts
git commit -m "feat: add config init"
```

## 任务 3：仓库输入解析

**文件：**
- 新建：`src/git-url.ts`
- 测试：`test/git-url.test.ts`

- [ ] **步骤 1：写解析器测试**

新建 `test/git-url.test.ts`，覆盖：

```ts
import { describe, expect, test } from "bun:test";
import { parseRepoInput } from "../src/git-url";

describe("parseRepoInput", () => {
  test("parses short owner/repo input", () => {
    expect(parseRepoInput("atian25/projj", "github.com")).toEqual({
      host: "github.com",
      owner: "atian25",
      repo: "projj",
      cloneUrl: "git@github.com:atian25/projj.git",
      relPath: "github.com/atian25/projj",
    });
  });

  test("parses https input", () => {
    expect(parseRepoInput("https://github.com/eggjs/egg.git", "github.com")).toMatchObject({
      host: "github.com",
      owner: "eggjs",
      repo: "egg",
      cloneUrl: "https://github.com/eggjs/egg.git",
    });
  });

  test("parses scp-like ssh input", () => {
    expect(parseRepoInput("git@github.com:atian25/projj.git", "github.com")).toMatchObject({
      host: "github.com",
      owner: "atian25",
      repo: "projj",
    });
  });

  test("parses ssh url with port", () => {
    expect(parseRepoInput("ssh://git@git.example.com:2224/team/app.git", "github.com")).toMatchObject({
      host: "git.example.com",
      owner: "team",
      repo: "app",
    });
  });
});
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`bun test test/git-url.test.ts`

预期：失败，因为 `src/git-url.ts` 还不存在。

- [ ] **步骤 3：实现解析器**

新建 `src/git-url.ts`，实现：

```ts
export type RepoInfo = {
  host: string;
  owner: string;
  repo: string;
  cloneUrl: string;
  relPath: string;
};

function stripGitSuffix(value: string): string {
  return value.replace(/\/$/, "").replace(/\.git$/, "");
}

function buildInfo(host: string, owner: string, repo: string, cloneUrl: string): RepoInfo {
  const cleanRepo = stripGitSuffix(repo);
  return {
    host,
    owner,
    repo: cleanRepo,
    cloneUrl,
    relPath: `${host}/${owner}/${cleanRepo}`,
  };
}

export function parseRepoInput(input: string, defaultPlatform: string): RepoInfo {
  const value = input.trim();
  const shortMatch = value.match(/^([^/:@]+)\/([^/:@]+)$/);
  if (shortMatch) {
    const owner = shortMatch[1]!;
    const repo = stripGitSuffix(shortMatch[2]!);
    return buildInfo(defaultPlatform, owner, repo, `git@${defaultPlatform}:${owner}/${repo}.git`);
  }

  const scpMatch = value.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  if (scpMatch && !value.includes("://")) {
    const host = scpMatch[1]!;
    const parts = stripGitSuffix(scpMatch[2]!).split("/");
    if (parts.length >= 2) {
      const repo = parts.pop()!;
      const owner = parts.join("/");
      return buildInfo(host, owner, repo, value);
    }
  }

  try {
    const url = new URL(value);
    const host = url.hostname;
    const parts = stripGitSuffix(url.pathname.replace(/^\//, "")).split("/");
    if (host && parts.length >= 2) {
      const repo = parts.pop()!;
      const owner = parts.join("/");
      return buildInfo(host, owner, repo, value);
    }
  } catch {
    throw new Error(`unsupported repository input: ${input}`);
  }

  throw new Error(`unsupported repository input: ${input}`);
}
```

- [ ] **步骤 4：运行测试并提交**

运行：`bun test test/git-url.test.ts`

预期：通过。

运行：`bun run typecheck`

预期：通过。

```bash
git add src/git-url.ts test/git-url.test.ts
git commit -m "feat: parse repository inputs"
```

## 任务 4：仓库扫描和查找

**文件：**
- 新建：`src/repos.ts`
- 测试：`test/repos.test.ts`
- 修改：`src/cli.ts`

- [ ] **步骤 1：写扫描和匹配测试**

新建 `test/repos.test.ts`，覆盖：

- 只识别 `base/host/owner/repo/.git`。
- 跳过没有 `.git` 的目录。
- repo 名精确匹配优先于子串匹配。
- `owner/repo` 大小写不敏感匹配。

使用这些测试数据：

```ts
{ key: "github.com/atian25/projj", path: "/base/github.com/atian25/projj" }
{ key: "github.com/atian25/projj-tools", path: "/base/github.com/atian25/projj-tools" }
{ key: "github.com/eggjs/egg", path: "/base/github.com/eggjs/egg" }
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`bun test test/repos.test.ts`

预期：失败，因为 `src/repos.ts` 还不存在。

- [ ] **步骤 3：实现扫描和匹配**

新建 `src/repos.ts`，提供：

```ts
export type Repo = {
  base: string;
  host: string;
  owner: string;
  name: string;
  path: string;
  key: string;
};

export async function scanRepos(baseDirs: string[]): Promise<Repo[]>;
export function findRepos(repos: Repo[], query?: string): Repo[];
```

实现要求：

- 只扫描三层：`base/host/owner/repo`。
- 只有存在 `.git` 目录才算 repo。
- 跳过以 `.` 开头的 host、owner、repo 目录。
- `findRepos` 没有搜索词时返回全部仓库。
- 排序规则：repo 名精确匹配、`owner/repo` 精确匹配、`host/owner/repo` 精确匹配、子串匹配、路径排序。

- [ ] **步骤 4：运行测试并提交**

运行：`bun test test/repos.test.ts`

预期：通过。

运行：`bun run typecheck`

预期：通过。

```bash
git add src/repos.ts test/repos.test.ts
git commit -m "feat: scan and find repositories"
```

## 任务 5：`find`、选择器和 shell finalizer

**文件：**
- 修改：`src/cli.ts`
- 新建：`src/select.ts`
- 新建：`src/shell.ts`
- 测试：`test/shell.test.ts`

- [ ] **步骤 1：写 finalizer 测试**

新建 `test/shell.test.ts`，覆盖：

- 设置 `PROJJ_FINALIZER_FILE` 时写入 `cd:/tmp/repo\n`。
- 未设置 `PROJJ_FINALIZER_FILE` 时返回 `false`。
- `shellInit("zsh")` 输出包含 `PROJJ_FINALIZER_FILE` 和 `cd:`。

- [ ] **步骤 2：运行测试，确认失败**

运行：`bun test test/shell.test.ts`

预期：失败，因为 `src/shell.ts` 还不存在。

- [ ] **步骤 3：实现 shell helper**

新建 `src/shell.ts`，提供：

```ts
export type SupportedShell = "zsh" | "bash" | "fish";

export async function writeCdFinalizer(
  path: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean>;

export function shellInit(shell: SupportedShell): string;
```

实现要求：

- `writeCdFinalizer` 只在 `PROJJ_FINALIZER_FILE` 存在时写文件。
- 写入格式固定为 `cd:<absolute-path>\n`。
- zsh/bash wrapper 负责创建临时文件、运行真实 `projj`、读取 `cd:`、删除临时文件、返回原退出码。
- fish wrapper 行为一致。

- [ ] **步骤 4：实现选择器**

新建 `src/select.ts`，提供：

```ts
import type { Repo } from "./repos";

export async function selectRepo(repos: Repo[]): Promise<Repo | null>;
```

实现要求：

- 0 个 repo 返回 `null`。
- 1 个 repo 直接返回。
- TTY 中优先调用 `fzf`。
- `fzf` 不可用或未选择时，回退到编号选择。
- 非 TTY 且有多个 repo 时返回 `null`。

- [ ] **步骤 5：接入 `find` 和 `shell-init`**

修改 `src/cli.ts`：

- `projj find [搜索词]`：扫描配置 base，匹配仓库，选择目标，写 `cd:` finalizer。
- `projj find --list [搜索词]`：只输出匹配仓库绝对路径，每行一个，不写 finalizer。
- 未加载 shell 集成但需要跳转时：stdout 打印路径，stderr 提示 `eval "$(projj shell-init zsh)"`。
- `projj shell-init <zsh|bash|fish>`：输出对应 shell wrapper。

- [ ] **步骤 6：运行测试并提交**

运行：`bun test test/shell.test.ts test/repos.test.ts`

预期：通过。

运行：`bun run typecheck`

预期：通过。

```bash
git add src/cli.ts src/select.ts src/shell.ts test/shell.test.ts
git commit -m "feat: add find navigation"
```

## 任务 6：`clone` 命令

**文件：**
- 新建：`src/git.ts`
- 修改：`src/cli.ts`
- 测试：`test/git.test.ts`

- [ ] **步骤 1：写 clone helper 测试**

新建 `test/git.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { targetPathForRepo } from "../src/git";
import type { RepoInfo } from "../src/git-url";

const info: RepoInfo = {
  host: "github.com",
  owner: "atian25",
  repo: "projj",
  cloneUrl: "git@github.com:atian25/projj.git",
  relPath: "github.com/atian25/projj",
};

describe("git", () => {
  test("computes target path", () => {
    expect(targetPathForRepo("/Users/tz/projj", info)).toBe(
      join("/Users/tz/projj", "github.com", "atian25", "projj"),
    );
  });
});
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`bun test test/git.test.ts`

预期：失败，因为 `src/git.ts` 还不存在。

- [ ] **步骤 3：实现 git helper**

新建 `src/git.ts`，提供：

```ts
import type { RepoInfo } from "./git-url";

export function targetPathForRepo(base: string, info: RepoInfo): string;
export async function pathExists(path: string): Promise<boolean>;
export async function cloneRepo(cloneUrl: string, targetPath: string): Promise<void>;
```

实现要求：

- `targetPathForRepo` 返回 `<base>/<host>/<owner>/<repo>`。
- `pathExists` 用于判断目标路径是否已存在。
- `cloneRepo` 创建父目录后执行 `git clone <cloneUrl> <targetPath>`。
- clone 失败时抛出包含退出码的错误。

- [ ] **步骤 4：接入 `projj clone`**

修改 `src/cli.ts`：

- 解析 `projj clone <repo> [--base <path>] [--cd]`。
- 用 `loadConfig()` 获取 `platform` 和默认 base。
- 用 `parseRepoInput()` 解析 repo 输入。
- 默认 base 使用配置中的第一个 base。
- `--base <path>` 覆盖本次 clone 的 base。
- 目标路径存在时报告 `exists <path>` 并成功退出。
- 目标路径不存在时执行 clone，并报告 `cloned <path>`。
- 带 `--cd` 时写入 `cd:` finalizer；没有 shell 集成时打印路径并给出启用提示。

- [ ] **步骤 5：运行测试并提交**

运行：`bun test test/git.test.ts test/git-url.test.ts`

预期：通过。

运行：`bun run typecheck`

预期：通过。

```bash
git add src/cli.ts src/git.ts test/git.test.ts
git commit -m "feat: add clone command"
```

## 任务 7：`run` 命令

**文件：**
- 新建：`src/run.ts`
- 修改：`src/cli.ts`
- 测试：`test/run.test.ts`

- [ ] **步骤 1：写 run 测试**

新建 `test/run.test.ts`，覆盖：

- 配置任务优先于原始命令。
- 未命中任务时按原始命令运行。
- `--match` 用正则过滤 repo key。

核心断言：

```ts
expect(resolveCommand("status", ["--short"], { status: "git status" })).toBe(
  "git status --short",
);
expect(resolveCommand("git status", [], {})).toBe("git status");
expect(filterReposByMatch(repos, "egg").map((repo) => repo.key)).toEqual([
  "github.com/eggjs/egg",
]);
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`bun test test/run.test.ts`

预期：失败，因为 `src/run.ts` 还不存在。

- [ ] **步骤 3：实现 run helper**

新建 `src/run.ts`，提供：

```ts
import type { Repo } from "./repos";

export function shellQuote(arg: string): string;
export function resolveCommand(
  commandOrTask: string,
  args: string[],
  tasks: Record<string, string>,
): string;
export function filterReposByMatch(repos: Repo[], pattern?: string): Repo[];
export async function runShellCommand(command: string, cwd: string): Promise<number>;
```

实现要求：

- `resolveCommand` 先查 `tasks[commandOrTask]`，未命中则使用 `commandOrTask`。
- `--` 后的参数用 `shellQuote` 追加。
- `filterReposByMatch` 对 `repo.key` 做正则匹配。
- `runShellCommand` 使用 shell 执行，并继承 stdio。

- [ ] **步骤 4：接入 `projj run`**

修改 `src/cli.ts`：

- 解析 `projj run <命令或任务> [--all] [--match <regex>] [-- ...args]`。
- 不带 `--all` 时在当前目录运行。
- 带 `--all` 时扫描全部 repo，在每个 repo 下运行。
- 每个 repo 执行前输出 `==> <host>/<owner>/<repo>`。
- 任一 repo 失败时，最终退出码使用最后一个非 0 退出码。

- [ ] **步骤 5：运行测试并提交**

运行：`bun test test/run.test.ts`

预期：通过。

运行：`bun run typecheck`

预期：通过。

```bash
git add src/cli.ts src/run.ts test/run.test.ts
git commit -m "feat: add run command"
```

## 任务 8：端到端验证和 README

**文件：**
- 修改：`README.md`
- 如果实现中行为和设计发生变化，修改：`docs/superpowers/specs/2026-04-28-projj-cli-design.md`

- [ ] **步骤 1：运行完整自动化检查**

运行：`bun test`

预期：全部测试通过。

运行：`bun run typecheck`

预期：通过。

- [ ] **步骤 2：用临时 HOME 验证基本命令**

运行：

```bash
tmp_home="$(mktemp -d)"
HOME="$tmp_home" bun run src/index.ts init
HOME="$tmp_home" bun run src/index.ts find --list
HOME="$tmp_home" bun run src/index.ts shell-init zsh
```

预期：

- `init` 输出 `created <tmp_home>/.projj/config.toml`。
- `find --list` 因没有仓库而退出码为 1。
- `shell-init zsh` 输出包含 `PROJJ_FINALIZER_FILE` 的 shell 函数。

- [ ] **步骤 3：更新 README**

把 `README.md` 更新为中文使用说明：

```md
# projj

`projj` 管理本地 git 仓库目录。

目录规范：

```text
~/projj/github.com/atian25/projj
~/projj/github.com/eggjs/egg
```

## 开始使用

```sh
projj init
eval "$(projj shell-init zsh)"
projj clone atian25/projj --cd
projj find egg
projj find --list
projj run status --all
```

配置文件位于：

```text
~/.projj/config.toml
```
```

- [ ] **步骤 4：最终提交**

运行：`git status --short`

预期：README 和实现文件已修改或新增。

```bash
git add README.md docs/superpowers/specs/2026-04-28-projj-cli-design.md package.json bun.lock tsconfig.json src test
git commit -m "docs: add cli usage"
```

## 自检

- 设计覆盖：`init`、`clone`、`find --list`、默认跳转、`run`、`shell-init`、配置路径、目录规范、finalizer、测试策略都有对应任务。
- 完整性检查：没有模糊或未完成步骤。
- 类型一致性：`Repo`、`RepoInfo`、`ProjjConfig`、`Output` 先定义，再在后续任务中使用。
