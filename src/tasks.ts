import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import { shellQuote } from "./run";

type TaskMap = Record<string, string>;
export type TaskListGroup = {
  source: string;
  tasks: Array<{ name: string; command: string }>;
};

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

export async function listRunTasks(
  cwd: string,
  globalTasks: TaskMap,
  options: { globalSource?: string } = {},
): Promise<TaskListGroup[]> {
  return [
    ...(await listProjjTasks(cwd)),
    ...(await listPackageScripts(cwd)),
    ...(await listDetectedTasks(cwd)),
    ...taskMapToGroups(options.globalSource ?? "global", globalTasks),
  ];
}

export function formatTaskList(title: string, groups: TaskListGroup[]): string {
  const lines = [title, ""];
  if (groups.length === 0) {
    lines.push("No tasks found.");
    return `${lines.join("\n")}\n`;
  }

  for (const group of groups) {
    lines.push(group.source);
    const width = Math.max(...group.tasks.map((task) => task.name.length));
    for (const task of group.tasks) {
      lines.push(`  ${task.name.padEnd(width)}  ${task.command}`);
    }
  }

  return `${lines.join("\n")}\n`;
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

async function listProjjTasks(cwd: string): Promise<TaskListGroup[]> {
  const path = join(cwd, ".projj.toml");
  const raw = await readOptionalFile(path);
  if (raw === undefined) return [];

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (error) {
    throw new Error(`invalid local task config: ${formatReason(error)}`);
  }

  if (!isRecord(parsed) || !hasOwn(parsed, "tasks")) return [];
  if (!isRecord(parsed.tasks)) {
    throw new Error("invalid local task config: tasks must be an object");
  }

  const tasks = entriesToTasks(parsed.tasks, "invalid local task config: tasks");
  return taskListGroup(".projj.toml", tasks);
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

async function listPackageScripts(cwd: string): Promise<TaskListGroup[]> {
  const path = join(cwd, "package.json");
  const raw = await readOptionalFile(path);
  if (raw === undefined) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid package.json: ${formatReason(error)}`);
  }

  if (!isRecord(parsed) || !isRecord(parsed.scripts)) return [];
  const tasks = entriesToTasks(parsed.scripts, "invalid package.json: scripts");
  return taskListGroup("package.json", tasks);
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

async function listDetectedTasks(cwd: string): Promise<TaskListGroup[]> {
  const tasks = [
    ...(await listSimpleTargetTasks(cwd, ["Makefile", "makefile"], "make")),
    ...(await listSimpleTargetTasks(cwd, ["justfile", "Justfile"], "just")),
    ...(await listTaskfileTasks(cwd)),
    ...(await listMappedFileTasks(cwd, "Cargo.toml", "cargo", CARGO_TASKS)),
    ...(await listMappedFileTasks(cwd, "go.mod", "go", GO_TASKS)),
  ].sort(byTaskName);

  return taskListGroup("detected", tasks);
}

async function listSimpleTargetTasks(
  cwd: string,
  names: string[],
  runner: string,
): Promise<Array<{ name: string; command: string }>> {
  const path = (await firstExisting(cwd, names)) ?? "";
  if (!path) return [];

  const raw = await readFile(path, "utf8");
  const namesSeen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (line.startsWith(" ") || line.startsWith("\t") || trimmed.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:/);
    if (match?.[1]) namesSeen.add(match[1]);
  }

  return [...namesSeen].sort().map((name) => ({
    name: `${runner}:${name}`,
    command: `${runner} ${shellQuote(name)}`,
  }));
}

async function listTaskfileTasks(cwd: string): Promise<Array<{ name: string; command: string }>> {
  const path = (await firstExisting(cwd, ["Taskfile.yml", "Taskfile.yaml"])) ?? "";
  if (!path) return [];

  const raw = await readFile(path, "utf8");
  if (looksInvalidTaskfile(raw)) {
    throw new Error("invalid Taskfile: unsupported tasks structure");
  }

  const lines = raw.split(/\r?\n/);
  const tasksIndex = lines.findIndex((line) => /^tasks\s*:\s*$/.test(line));
  if (tasksIndex === -1) return [];

  const namesSeen = new Set<string>();
  for (const line of lines.slice(tasksIndex + 1)) {
    const match = line.match(/^\s{2}([A-Za-z0-9_.-]+)\s*:/);
    if (match?.[1]) namesSeen.add(match[1]);
  }

  return [...namesSeen].sort().map((name) => ({
    name: `task:${name}`,
    command: `task ${shellQuote(name)}`,
  }));
}

async function listMappedFileTasks(
  cwd: string,
  file: string,
  prefix: string,
  tasks: TaskMap,
): Promise<Array<{ name: string; command: string }>> {
  if (!(await exists(join(cwd, file)))) return [];
  return Object.entries(tasks)
    .map(([name, command]) => ({ name: `${prefix}:${name}`, command }))
    .sort(byTaskName);
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

function taskMapToGroups(source: string, map: TaskMap): TaskListGroup[] {
  return taskListGroup(
    source,
    Object.entries(map).map(([name, command]) => ({ name, command })),
  );
}

function taskListGroup(
  source: string,
  tasks: Array<{ name: string; command: string }>,
): TaskListGroup[] {
  const sorted = tasks.sort(byTaskName);
  return sorted.length > 0 ? [{ source, tasks: sorted }] : [];
}

function entriesToTasks(
  record: Record<string, unknown>,
  errorPrefix: string,
): Array<{ name: string; command: string }> {
  return Object.entries(record).map(([name, command]) => {
    if (typeof command !== "string") {
      throw new Error(`${errorPrefix}.${name} must be a string`);
    }
    return { name, command };
  });
}

function byTaskName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
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
