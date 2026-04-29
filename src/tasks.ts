import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import { shellQuote } from "./run";

type TaskMap = Record<string, string>;
type ResolvedCommand = {
  command: string;
  appendSeparator?: boolean;
};

const CARGO_TASKS: TaskMap = {
  test: "cargo test",
  build: "cargo build",
  check: "cargo check",
  run: "cargo run",
  bench: "cargo bench",
  doc: "cargo doc",
  fmt: "cargo fmt",
  clippy: "cargo clippy",
};

const GO_TASKS: TaskMap = {
  test: "go test ./...",
  build: "go build ./...",
  run: "go run .",
  fmt: "go fmt ./...",
  vet: "go vet ./...",
};

export async function resolveRunCommand(
  commandOrTask: string,
  args: string[],
  globalTasks: TaskMap,
  cwd: string,
): Promise<string> {
  const resolved =
    (await resolveLocalTask(commandOrTask, cwd)) ??
    (globalTasks[commandOrTask] ? { command: globalTasks[commandOrTask] } : undefined) ??
    { command: commandOrTask };

  return appendArgs(resolved, args);
}

function appendArgs(resolved: ResolvedCommand, args: string[]): string {
  if (args.length === 0) return resolved.command;
  const separator = resolved.appendSeparator ? " --" : "";
  return `${resolved.command}${separator} ${args.map(shellQuote).join(" ")}`;
}

async function resolveLocalTask(task: string, cwd: string): Promise<ResolvedCommand | undefined> {
  return (
    (await resolveProjjTask(task, cwd)) ??
    (await resolvePackageScript(task, cwd)) ??
    (await resolveMakeTask(task, cwd)) ??
    (await resolveJustTask(task, cwd)) ??
    (await resolveTaskfileTask(task, cwd)) ??
    (await resolveMappedFileTask(task, cwd, "Cargo.toml", CARGO_TASKS)) ??
    (await resolveMappedFileTask(task, cwd, "go.mod", GO_TASKS))
  );
}

async function resolveProjjTask(task: string, cwd: string): Promise<ResolvedCommand | undefined> {
  const path = join(cwd, ".projj.toml");
  const raw = await readOptionalFile(path);
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (error) {
    throw new Error(`invalid local task config: ${formatReason(error)}`);
  }

  if (!isRecord(parsed) || !hasOwn(parsed, "tasks")) return undefined;
  if (!isRecord(parsed.tasks)) {
    throw new Error("invalid local task config: tasks must be an object");
  }

  const command = parsed.tasks[task];
  if (command === undefined) return undefined;
  if (typeof command !== "string") {
    throw new Error(`invalid local task config: tasks.${task} must be a string`);
  }

  return { command };
}

async function resolvePackageScript(task: string, cwd: string): Promise<ResolvedCommand | undefined> {
  const path = join(cwd, "package.json");
  const raw = await readOptionalFile(path);
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid package.json: ${formatReason(error)}`);
  }

  if (!isRecord(parsed) || !isRecord(parsed.scripts)) return undefined;
  if (typeof parsed.scripts[task] !== "string") return undefined;

  return {
    command: `${await detectPackageManager(cwd)} run ${shellQuote(task)}`,
    appendSeparator: true,
  };
}

async function detectPackageManager(cwd: string): Promise<string> {
  if (await exists(join(cwd, "bun.lock"))) return "bun";
  if (await exists(join(cwd, "bun.lockb"))) return "bun";
  if (await exists(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

async function resolveMakeTask(task: string, cwd: string): Promise<ResolvedCommand | undefined> {
  const path = (await firstExisting(cwd, ["Makefile", "makefile"])) ?? "";
  if (!path) return undefined;
  return (await hasSimpleTarget(path, task)) ? { command: `make ${shellQuote(task)}` } : undefined;
}

async function resolveJustTask(task: string, cwd: string): Promise<ResolvedCommand | undefined> {
  const path = (await firstExisting(cwd, ["justfile", "Justfile"])) ?? "";
  if (!path) return undefined;
  return (await hasSimpleTarget(path, task)) ? { command: `just ${shellQuote(task)}` } : undefined;
}

async function resolveTaskfileTask(task: string, cwd: string): Promise<ResolvedCommand | undefined> {
  const path = (await firstExisting(cwd, ["Taskfile.yml", "Taskfile.yaml"])) ?? "";
  if (!path) return undefined;

  const raw = await readFile(path, "utf8");
  if (looksInvalidTaskfile(raw)) {
    throw new Error("invalid Taskfile: unsupported tasks structure");
  }

  return hasTaskfileTask(raw, task) ? { command: `task ${shellQuote(task)}` } : undefined;
}

async function resolveMappedFileTask(
  task: string,
  cwd: string,
  file: string,
  tasks: TaskMap,
): Promise<ResolvedCommand | undefined> {
  if (!(await exists(join(cwd, file)))) return undefined;
  const command = tasks[task];
  return command ? { command } : undefined;
}

async function hasSimpleTarget(path: string, target: string): Promise<boolean> {
  const raw = await readFile(path, "utf8");
  const targetPattern = new RegExp(`^${escapeRegExp(target)}\\s*:`);

  return raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .some((line) => {
      const trimmed = line.trimStart();
      return !line.startsWith(" ") && !line.startsWith("\t") && !trimmed.startsWith("#") && targetPattern.test(line);
    });
}

function hasTaskfileTask(raw: string, task: string): boolean {
  const lines = raw.split(/\r?\n/);
  const tasksIndex = lines.findIndex((line) => /^tasks\s*:\s*$/.test(line));
  if (tasksIndex === -1) return false;

  const taskPattern = new RegExp(`^\\s{2}${escapeRegExp(task)}\\s*:`);
  return lines.slice(tasksIndex + 1).some((line) => taskPattern.test(line));
}

function looksInvalidTaskfile(raw: string): boolean {
  const lines = raw.split(/\r?\n/);
  const tasksIndex = lines.findIndex((line) => /^tasks\s*:\s*$/.test(line));
  if (tasksIndex === -1) return false;

  return lines
    .slice(tasksIndex + 1)
    .some((line) => /^\s+\[/.test(line) || /^\s+\{/.test(line));
}

async function firstExisting(cwd: string, names: string[]): Promise<string | undefined> {
  for (const name of names) {
    const path = join(cwd, name);
    if (await exists(path)) return path;
  }
  return undefined;
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
