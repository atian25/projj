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

### `projj clone <repo> [--base <path>] [--no-cd]`

Clone a repository into the conventional directory. Short names, HTTPS URLs, and SSH URLs are supported:

```sh
projj clone eggjs/egg
projj clone https://github.com/eggjs/egg.git
projj clone git@github.com:atian25/projj.git
```

Short names use the configured `platform`. `--base` overrides the root directory for this clone; relative paths are resolved from the current directory. By default, clone attempts to change the current shell to the repository directory after cloning. Use `--no-cd` to clone without jumping.

### Post-clone hooks

`projj clone` can run hook steps after a repository is cloned for the first time. `[[hooks]]` is TOML syntax for an array of hook entries, so you can define more than one hook:

```toml
[tasks]
zoxide = "zoxide add ."

[[hooks]]
event = "post_clone"
filter = "github.com/*/*"
tasks = [
  "git config user.name TZ",
  "git config user.email atian25@qq.com",
  "zoxide",
]

[[hooks]]
event = "post_clone"
filter = "code.byted.org/*/*"
tasks = [
  "git config user.name TZ",
  "git config user.email liuyong.tz@bytedance.com",
]
```

Hooks only run after a new clone succeeds. If the target repository already exists, hooks are skipped. Hook steps run in the cloned repository and use the same task resolution as `projj run`: each item in `tasks` can be a local project task, a global `[tasks]` name, or a raw shell command. Multi-line TOML arrays are supported and are usually clearer for hooks with several steps.

Hook filters use repository selectors. A scanned repository key looks like `github.com/owner/repo`, so host-wide rules should use patterns such as `github.com/*/*` or `code.byted.org/*/*`.

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

### `projj run <command-or-task> [--all] [--filter <selector>] [-- ...args]`

Run a configured task or a raw shell command. Without `--all` or `--filter`, the command runs in the current directory. With `--all`, it runs in every discovered repository. With `--filter`, it runs in matching repositories by name, `owner/repo`, or `host/owner/repo`. `*` wildcards are supported:

```sh
projj run test
projj run status --filter 'atian25/*'
projj run status --filter 'github.com/atian25/*'
projj run git status --all
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

Tasks are resolved in the execution directory. Project-local definitions take precedence over global shortcuts:

```text
1. .projj.toml [tasks]
2. project task files
3. ~/.projj/config.toml [tasks]
4. raw shell command
```

Project task files include:

```text
package.json scripts  -> bun/pnpm/yarn/npm run <script>
Makefile              -> make <target>
justfile / Justfile   -> just <recipe>
Taskfile.yml          -> task <task>
Cargo.toml            -> cargo test/build/check/run/...
go.mod                -> go test/build/fmt/vet/...
```

For example, if a repository has `package.json` with `scripts.test`, then `projj run test --filter <repo>` runs that package script in the repository. If another matched repository is a Go module, the same command can resolve to `go test ./...` there.

Use `--` before the command to force a raw shell command and skip task resolution:

```sh
projj run -- test -f package.json
projj run --filter egg-view -- ls -a
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

Default tasks:

```toml
[tasks]
status = "git status --short"
pull = "git pull --ff-only"
fetch = "git fetch --all --prune"
```

### `projj shell-init <zsh|bash|fish>`

Print shell integration code:

```sh
eval "$(projj shell-init zsh)"
```

Shell integration lets `projj clone` and `projj find` change the current shell directory.
