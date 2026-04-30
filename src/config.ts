import { dirname, isAbsolute, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse, stringify } from "smol-toml";

export type ProjjConfig = {
  base: string[];
  platform: string;
  tasks: Record<string, string>;
  hooks: HookConfig[];
};

export type HookConfig = {
  event: HookEvent;
  filter?: string;
  tasks: string[];
};

export type HookEvent = "post_clone" | `pre_${string}` | `post_${string}`;

const HOOK_EVENT_PATTERN = /^(pre|post)_[A-Za-z0-9_.-]+$/;

export function defaultConfig(): ProjjConfig {
  return {
    base: ["~/projj"],
    platform: "github.com",
    tasks: {},
    hooks: [],
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasField(record: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function normalizeParsedConfig(value: unknown): ProjjConfig {
  const record = isRecord(value) ? value : {};
  const defaults = defaultConfig();

  let base = defaults.base;
  if (hasField(record, "base")) {
    if (typeof record.base === "string") {
      base = [record.base];
    } else if (
      Array.isArray(record.base) &&
      record.base.every((item) => typeof item === "string")
    ) {
      base = record.base;
    } else {
      throw new Error("invalid config: base must be a string or string[]");
    }
  }

  let platform = defaults.platform;
  if (hasField(record, "platform")) {
    if (typeof record.platform !== "string") {
      throw new Error("invalid config: platform must be a string");
    }
    platform = record.platform;
  }

  let tasks = defaults.tasks;
  if (hasField(record, "tasks")) {
    if (!isRecord(record.tasks)) {
      throw new Error("invalid config: tasks must be an object");
    }
    for (const [key, val] of Object.entries(record.tasks)) {
      if (typeof val !== "string") {
        throw new Error(`invalid config: tasks.${key} must be a string`);
      }
    }
    tasks = record.tasks as Record<string, string>;
  }

  let hooks = defaults.hooks;
  if (hasField(record, "hooks")) {
    if (!Array.isArray(record.hooks)) {
      throw new Error("invalid config: hooks must be an array");
    }
    hooks = record.hooks.map((hook, index) => normalizeHookConfig(hook, index));
  }

  return { base, platform, tasks, hooks };
}

function normalizeHookConfig(value: unknown, index: number): HookConfig {
  if (!isRecord(value)) {
    throw new Error(`invalid config: hooks[${index}] must be an object`);
  }
  if (!isHookEvent(value.event)) {
    throw new Error(
      `invalid config: hooks[${index}].event must be post_clone or pre_<task>/post_<task>`,
    );
  }
  if (
    !Array.isArray(value.tasks) ||
    value.tasks.length === 0 ||
    !value.tasks.every((task) => typeof task === "string")
  ) {
    throw new Error(`invalid config: hooks[${index}].tasks must be a non-empty string[]`);
  }
  if (hasField(value, "filter") && typeof value.filter !== "string") {
    throw new Error(`invalid config: hooks[${index}].filter must be a string`);
  }

  return {
    event: value.event,
    tasks: [...value.tasks],
    ...(typeof value.filter === "string" ? { filter: value.filter } : {}),
  };
}

function isHookEvent(value: unknown): value is HookEvent {
  return (
    typeof value === "string" &&
    (value === "post_clone" ||
      (value !== "pre_clone" && value !== "post_clone" && HOOK_EVENT_PATTERN.test(value)))
  );
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
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, stringify(defaultConfig()), { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}
