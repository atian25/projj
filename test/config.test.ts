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
});
