import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
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
      hooks: [],
    });
  });

  test("default config includes empty hooks", () => {
    expect(defaultConfig().hooks).toEqual([]);
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

  test("save default config does not overwrite existing config", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const root = dir.trim();
    const configPath = join(root, ".projj", "config.toml");
    const customConfig = 'platform = "git.example.com"\nbase = ["~/code"]\n';

    await saveDefaultConfig(configPath);
    await Bun.write(configPath, customConfig);

    await expect(saveDefaultConfig(configPath)).resolves.toBe(false);
    await expect(Bun.file(configPath).text()).resolves.toBe(customConfig);
  });

  test("load config rejects non-string base entries", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const root = dir.trim();
    const configPath = join(root, ".projj", "config.toml");

    await Bun.write(configPath, "base = [1]\n");

    await expect(loadConfig(configPath, root)).rejects.toThrow(
      "invalid config: base must be a string or string[]",
    );
  });

  test("load config rejects non-string task values", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const root = dir.trim();
    const configPath = join(root, ".projj", "config.toml");

    await Bun.write(configPath, '[tasks]\nstatus = 1\n');

    await expect(loadConfig(configPath, root)).rejects.toThrow(
      "invalid config: tasks.status must be a string",
    );
  });

  test("loads post_clone hooks", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const root = dir.trim();
    const configPath = join(root, ".projj", "config.toml");
    await Bun.$`mkdir -p ${dirname(configPath)}`;
    await Bun.write(
      configPath,
      [
        'base = ["~/projj"]',
        'platform = "github.com"',
        "",
        "[[hooks]]",
        'event = "post_clone"',
        'filter = "github.com/atian25/*"',
        'tasks = ["setup-git-user", "zoxide"]',
        "",
      ].join("\n"),
    );

    const config = await loadConfig(configPath, root);

    expect(config.hooks).toEqual([
      {
        event: "post_clone",
        filter: "github.com/atian25/*",
        tasks: ["setup-git-user", "zoxide"],
      },
    ]);
  });

  test("load config rejects invalid hooks", async () => {
    const cases: Array<{ name: string; toml: string; message: string }> = [
      {
        name: "non-array hooks",
        toml: 'hooks = "post_clone"',
        message: "invalid config: hooks must be an array",
      },
      {
        name: "unsupported event",
        toml: '[[hooks]]\nevent = "pre_clone"\ntasks = ["setup"]\n',
        message: "invalid config: hooks[0].event must be post_clone",
      },
      {
        name: "empty tasks",
        toml: '[[hooks]]\nevent = "post_clone"\ntasks = []\n',
        message: "invalid config: hooks[0].tasks must be a non-empty string[]",
      },
      {
        name: "non-string filter",
        toml: '[[hooks]]\nevent = "post_clone"\nfilter = 1\ntasks = ["setup"]\n',
        message: "invalid config: hooks[0].filter must be a string",
      },
    ];

    for (const item of cases) {
      const dir = await Bun.$`mktemp -d`.text();
      const root = dir.trim();
      const configPath = join(root, ".projj", "config.toml");
      await Bun.$`mkdir -p ${dirname(configPath)}`;
      await Bun.write(configPath, item.toml);

      await expect(loadConfig(configPath, root), item.name).rejects.toThrow(item.message);
    }
  });
});
