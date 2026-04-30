# projj

`projj` manages local git repository directories.

Directory convention:

```text
~/projj/github.com/atian25/projj
~/projj/github.com/eggjs/egg
```

## Quick Start

```sh
bun install
bun link
projj init
eval "$(projj shell-init zsh)"
projj clone atian25/projj
projj find egg
projj find --list
projj status --dry-run
projj start --dry-run
projj install --dry-run
projj clean --dry-run
projj stop --dry-run
projj run status --all
```

Config file:

```text
~/.projj/config.toml
```

To install shell integration for future zsh sessions:

```sh
echo 'eval "$(projj shell-init zsh)"' >> ~/.zshrc
source ~/.zshrc
```

## Commands

### `projj init`

Create the default config file. Existing config is not overwritten.

### `projj clone <repo> [--base <path>] [--no-cd] [--dry-run]`

Clone a repository into the conventional directory. Short names, HTTPS URLs, and SSH URLs are supported:

```sh
projj clone eggjs/egg
projj clone https://github.com/eggjs/egg.git
projj clone git@github.com:atian25/projj.git
projj clone atian25/ppt-test --dry-run
```

Short names use the configured `platform`. `--base` overrides the root directory for this clone; relative paths are resolved from the current directory. By default, clone attempts to change the current shell to the repository directory after cloning. Use `--no-cd` to clone without jumping. `--dry-run` prints the clone URL and target path without cloning, running post-clone hooks, or changing directories.

### Post-clone hooks

`projj clone` can run hook steps after a repository is cloned for the first time. `[[hooks]]` is TOML syntax for an array of hook entries, so you can define more than one hook:

```toml
[tasks]
list-files = "ls -a"

[[hooks]]
event = "post_clone"
filter = "github.com/*/*"
tasks = [
  "git config user.name TZ",
  "git config user.email me@example.com",
  "list-files",
]

[[hooks]]
event = "post_clone"
filter = "gitlab.example.com/*/*"
tasks = [
  "git config user.name TZ",
  "git config user.email work@example.com",
]
```

Hooks only run after a new clone succeeds. If the target repository already exists, hooks are skipped. Hook steps run in the cloned repository and use the same task resolution as `projj run`: each item in `tasks` can be a local project task, a global `[tasks]` name, or a raw shell command. Multi-line TOML arrays are supported and are usually clearer for hooks with several steps.

Hook filters use repository selectors. A scanned repository key looks like `github.com/owner/repo`, so host-wide rules should use patterns such as `github.com/*/*` or `gitlab.example.com/*/*`.

Hook tasks receive these environment variables:

```text
PROJJ_EVENT
PROJJ_REPO_PATH
PROJJ_REPO_HOST
PROJJ_REPO_OWNER
PROJJ_REPO_NAME
PROJJ_REPO_URL
```

### `projj hooks run <event> [--all] [--filter <selector>] [--dry-run]`

Run configured hooks manually. The first supported event is `post_clone`. Without `--all` or `--filter`, hooks run in the current managed repository:

```sh
projj hooks run post_clone --dry-run
projj hooks run post_clone
```

Use `--filter` or `--all` to target repositories from configured `base` directories:

```sh
projj hooks run post_clone --filter atian25/projj --dry-run
projj hooks run post_clone --all --dry-run
projj hooks run post_clone --all
```

Use this to apply clone setup hooks to repositories that already exist. `--dry-run` prints the matched repositories and resolved hook commands without executing them. If the current directory is not managed by `projj`, pass `--all` or `--filter`.

### `projj find [query] [--list]`

Scan configured `base` directories and find repositories. By default, it jumps to the selected repository. `--list` only prints matching paths, one per line, for scripts.

### `projj run --list [--all] [--filter <selector>]`

List runnable tasks without executing them:

```sh
projj run --list
projj run --list --filter egg-view
projj run --list --all
```

Tasks are grouped by source, such as `.projj.toml`, `package.json`, detected project files, and global tasks. The global group includes the config file path so you know where to edit it.

### `projj run <task> [--all] [--filter <selector>] [-- ...args]`

Run a configured or detected task. Without `--all` or `--filter`, the task runs in the current directory. With `--all`, it runs in every discovered repository. With `--filter`, it runs in matching repositories by name, `owner/repo`, or `host/owner/repo`. `*` wildcards are supported:

```sh
projj run test
projj run status --filter 'atian25/*'
projj run status --filter 'github.com/atian25/*'
projj run -- ls -a
projj run --filter egg-view -- ls -a
projj run status -- --short
```

Use `--dry-run` to preview resolved commands without executing them:

```sh
projj run test --dry-run
projj run test --filter egg --dry-run
```

Use `--changed` to run only in repositories where `git status --short` is non-empty:

```sh
projj run status --changed
projj run status --all --changed
projj run test --filter egg --changed --dry-run
```

Tasks are resolved in the execution directory. `projj` asks each provider to look for an explicit task with the requested name, then asks providers for known intent fallbacks such as `start`, `install`, `clean`, `stop`, `test`, `build`, and `run`.

Provider explicit lookup:

```text
.projj.toml provider      -> [tasks].<task>
package provider          -> package.json scripts.<task>
make / just / taskfile    -> target / recipe / task named <task>
global config provider    -> [tasks].<task>
```

Intent fallback:

```text
package.json scripts  -> intent-specific scripts such as dev/serve for start
package.json          -> package-manager install for install
Makefile              -> intent-specific targets such as dev/serve/run for start
justfile / Justfile   -> intent-specific recipes
Taskfile.yml          -> intent-specific tasks
Cargo.toml            -> cargo test/build/check/run/clean/...
go.mod                -> go test/build/fmt/vet/...
```

`install` intentionally skips `package.json` `scripts.install`. In npm-compatible package managers, that script is a lifecycle hook, not the usual "install dependencies" command.

Project-local definitions take precedence over global shortcuts, and all explicit tasks take precedence over intent fallback. For example, if global config defines `[tasks].test`, it wins over Cargo's `cargo test` fallback.

Provider files include:

```text
package.json
Makefile
justfile / Justfile
Taskfile.yml / Taskfile.yaml
Cargo.toml
go.mod
```

For example, if a repository has `package.json` with `scripts.test`, then `projj run test --filter <repo>` runs that package script in the repository. If another matched repository is a Go module and has no explicit `test` task, the same command can resolve to `go test ./...` there.

If no task matches, `projj` exits with code 1.

Use `--` before a command to run a raw shell command and skip task resolution and lifecycle hooks:

```sh
projj run -- test -f package.json
projj run --filter egg-view -- ls -a
```

Lifecycle hooks can run before and after named tasks:

```toml
[[hooks]]
event = "pre_test"
tasks = ["echo preparing"]

[[hooks]]
event = "post_test"
tasks = ["echo done"]
```

Hook event names use `pre_<task>` and `post_<task>`. Raw commands do not run lifecycle hooks.

Legacy detected task names are still listed with their provider prefix:

```text
detected
  cargo:test  cargo test
  go:test     go test ./...
```

For execution, use the plain task name:

```sh
projj run test
```

`run --all` and `run --filter` print the original task or command first, then the resolved command for each repository:

```text
Running in 2 repositories: test
==> github.com/eggjs/egg
$ npm run test
==> github.com/eggjs/egg-view
$ go test ./...
```

If the command itself prints nothing, there is no extra result output. For example, `git status --short` is silent when a repository is clean.

If `--filter` matches no repositories, `projj` exits with code 1. Batch runs continue after individual repository failures and print a final failure summary to stderr.

### `projj status [--dry-run] [-- ...args]`

Run the current project's `status` task:

```sh
projj status
projj status --dry-run
projj status -- --branch
projj run status --all
projj run status --filter egg --changed
```

`projj status` is shorthand for `projj run status` in the current directory. For multi-repository status checks, use `projj run status --filter/--all`; for changed-only filtering, use `projj run status --changed`.

If no explicit `status` task is found, `projj` falls back to:

```text
git status --short --branch
```

Define `status` in project or global tasks to override the default:

```toml
[tasks]
status = "git status --short"
```

### `projj start [--dry-run] [-- ...args]`

Start the current project by resolving the most likely local startup command:

```sh
projj start
projj start --dry-run
projj start -- --host 0.0.0.0
projj run start --filter 'atian25/*'
```

`projj start` is shorthand for `projj run start` in the current directory. For multi-repository startup, use `projj run start --filter/--all`. It resolves explicit `start` tasks first, then falls back to built-in startup conventions. It does not fall back to raw shell commands. Resolution order is:

```text
1. Explicit start tasks from the regular `projj run start` resolution chain:
   - .projj.toml [tasks].start
   - package.json scripts.start
   - Makefile / justfile / Taskfile start
   - ~/.projj/config.toml [tasks].start
2. Built-in startup fallbacks:
   - package.json scripts: dev, serve
   - Makefile / justfile / Taskfile tasks: dev, serve, run
   - Cargo.toml -> cargo run
   - go.mod -> go run .
```

Use `.projj.toml` when a project needs an explicit startup command:

```toml
[tasks]
start = "pnpm dev"
```

If no startup command is found, `projj` exits with code 1.

Lifecycle hooks can run before and after the startup command:

```toml
[[hooks]]
event = "pre_start"
tasks = ["echo preparing"]

[[hooks]]
event = "post_start"
tasks = ["echo started"]
```

`pre_start` runs before the resolved startup command. `post_start` runs after the startup command exits successfully.

### `projj install [--dry-run] [-- ...args]`

Install dependencies for the current project:

```sh
projj install
projj install --dry-run
projj install -- --frozen-lockfile
projj run install --filter 'atian25/*'
```

`projj install` is shorthand for `projj run install` in the current directory. For multi-repository installs, use `projj run install --filter/--all`.

Resolution order is:

```text
1. Explicit install tasks:
   - .projj.toml [tasks].install
   - Makefile / justfile / Taskfile install
   - ~/.projj/config.toml [tasks].install
2. Package manager declared by package.json packageManager:
   - "packageManager": "pnpm@..." -> pnpm install
   - "packageManager": "bun@..."  -> bun install
   - "packageManager": "yarn@..." -> yarn install
   - "packageManager": "npm@..."  -> npm install
3. Lockfile fallback:
   - bun.lock / bun.lockb -> bun install
   - pnpm-lock.yaml       -> pnpm install
   - yarn.lock            -> yarn install
   - package-lock.json    -> npm install
4. Available command fallback:
   - pnpm, then bun, then yarn, then npm
5. Final fallback:
   - pnpm install
```

`package.json` `scripts.install` is skipped because it is an npm lifecycle script. Use `.projj.toml`, Makefile, justfile, Taskfile, or global config when a project needs a custom install workflow.

### `projj clean [--dry-run] [-- ...args]`

Clean the current project by resolving an explicit project clean task or a safe language fallback:

```sh
projj clean
projj clean --dry-run
projj run clean --all --dry-run
```

`projj clean` is shorthand for `projj run clean` in the current directory. For multi-repository cleaning, use `projj run clean --filter/--all`.

Resolution order is:

```text
1. Explicit clean tasks:
   - .projj.toml [tasks].clean
   - package.json scripts.clean
   - Makefile / justfile / Taskfile clean
   - ~/.projj/config.toml [tasks].clean
2. Language fallback:
   - Cargo.toml -> cargo clean
```

`projj clean` does not guess destructive cleanup commands. It does not remove `dist`, `tmp`, or `node_modules`, and it does not run `git clean` unless you explicitly define that behavior in a task.

### `projj stop [--dry-run] [-- ...args]`

Stop the current project by resolving an explicit stop task:

```sh
projj stop
projj stop --dry-run
projj stop -- --graceful
projj run stop --filter 'atian25/*'
```

`projj stop` is shorthand for `projj run stop` in the current directory. For multi-repository stops, use `projj run stop --filter/--all`.

Resolution order is:

```text
1. Explicit stop tasks:
   - .projj.toml [tasks].stop
   - package.json scripts.stop
   - Makefile / justfile / Taskfile stop
   - ~/.projj/config.toml [tasks].stop
```

`projj stop` does not guess which port or process to kill. Define a `stop` task when a project has a specific shutdown command.

### `projj shell-init <zsh|bash|fish>`

Print shell integration code:

```sh
eval "$(projj shell-init zsh)"
```

Shell integration lets `projj clone` and `projj find` change the current shell directory.
