import { describe, expect, test } from "bun:test";
import type { HookConfig } from "../src/config";
import type { RepoInfo } from "../src/git-url";
import { buildHookEnv, runHooks, selectHooks } from "../src/hooks";

const repo: RepoInfo = {
  host: "github.com",
  owner: "atian25",
  repo: "projj",
  cloneUrl: "git@github.com:atian25/projj.git",
  relPath: "github.com/atian25/projj",
};

describe("hooks", () => {
  test("selects post_clone hooks by selector", () => {
    const hooks: HookConfig[] = [
      { event: "post_clone", tasks: ["all"] },
      { event: "post_clone", filter: "projj", tasks: ["repo"] },
      { event: "post_clone", filter: "atian25/*", tasks: ["owner"] },
      { event: "post_clone", filter: "github.com/atian25/*", tasks: ["host"] },
      { event: "post_clone", filter: "eggjs/*", tasks: ["miss"] },
    ];

    expect(selectHooks(hooks, "post_clone", repo).map((hook) => hook.tasks[0])).toEqual([
      "all",
      "repo",
      "owner",
      "host",
    ]);
  });

  test("builds hook environment", () => {
    expect(buildHookEnv("post_clone", repo, "/repo")).toEqual({
      PROJJ_EVENT: "post_clone",
      PROJJ_REPO_PATH: "/repo",
      PROJJ_REPO_HOST: "github.com",
      PROJJ_REPO_OWNER: "atian25",
      PROJJ_REPO_NAME: "projj",
      PROJJ_REPO_URL: "git@github.com:atian25/projj.git",
    });
  });

  test("runs hooks in order with resolved commands and env", async () => {
    const stdout: string[] = [];
    const calls: Array<{ command: string; cwd: string; env: Record<string, string> | undefined }> = [];

    const result = await runHooks({
      event: "post_clone",
      hooks: [
        { event: "post_clone", tasks: ["setup", "echo done"] },
        { event: "post_clone", filter: "github.com/atian25/*", tasks: ["status"] },
      ],
      repo,
      repoPath: "/repo",
      globalTasks: {
        setup: "git config user.email me@example.com",
        status: "git status --short",
      },
      output: { stdout: (text) => stdout.push(text), stderr: () => {} },
      runShellCommand: async (command, cwd, options) => {
        calls.push({ command, cwd, env: options?.env });
        return 0;
      },
    });

    expect(result).toEqual({ code: 0, matched: 2 });
    expect(stdout.join("")).toContain("hook post_clone: setup\n");
    expect(stdout.join("")).toContain("$ git config user.email me@example.com\n");
    expect(calls.map((call) => call.command)).toEqual([
      "git config user.email me@example.com",
      "echo done",
      "git status --short",
    ]);
    expect(calls.every((call) => call.cwd === "/repo")).toBe(true);
    expect(calls[0]?.env?.PROJJ_EVENT).toBe("post_clone");
    expect(calls[0]?.env?.PROJJ_REPO_NAME).toBe("projj");
  });

  test("stops on first failing hook task", async () => {
    const stderr: string[] = [];
    const calls: string[] = [];

    const result = await runHooks({
      event: "post_clone",
      hooks: [
        { event: "post_clone", tasks: ["setup", "next"] },
        { event: "post_clone", tasks: ["later"] },
      ],
      repo,
      repoPath: "/repo",
      globalTasks: { setup: "setup command" },
      output: { stdout: () => {}, stderr: (text) => stderr.push(text) },
      runShellCommand: async (command) => {
        calls.push(command);
        return 7;
      },
    });

    expect(result).toEqual({
      code: 7,
      matched: 2,
      failure: { event: "post_clone", task: "setup", code: 7 },
    });
    expect(calls).toEqual(["setup command"]);
    expect(stderr.join("")).toBe("hook post_clone failed: setup exited 7\n");
  });

  test("runHooks dry-run prints resolved hook tasks without executing", async () => {
    const stdout: string[] = [];
    let calls = 0;

    const result = await runHooks({
      event: "post_clone",
      hooks: [{ event: "post_clone", tasks: ["setup"] }],
      repo,
      repoPath: "/repo",
      globalTasks: { setup: "setup command" },
      output: { stdout: (text) => stdout.push(text), stderr: () => {} },
      dryRun: true,
      runShellCommand: async () => {
        calls += 1;
        return 0;
      },
    });

    expect(result).toEqual({ code: 0, matched: 1 });
    expect(calls).toBe(0);
    expect(stdout.join("")).toBe("hook post_clone: setup\n$ setup command\n");
  });

  test("runHooks reports no matching hooks", async () => {
    const result = await runHooks({
      event: "post_clone",
      hooks: [{ event: "post_clone", filter: "eggjs/*", tasks: ["setup"] }],
      repo,
      repoPath: "/repo",
      globalTasks: { setup: "setup command" },
      output: { stdout: () => {}, stderr: () => {} },
    });

    expect(result).toEqual({ code: 0, matched: 0 });
  });

  test("runHooks returns failure details", async () => {
    const result = await runHooks({
      event: "post_clone",
      hooks: [{ event: "post_clone", tasks: ["setup"] }],
      repo,
      repoPath: "/repo",
      globalTasks: { setup: "setup command" },
      output: { stdout: () => {}, stderr: () => {} },
      runShellCommand: async () => 7,
    });

    expect(result).toEqual({
      code: 7,
      matched: 1,
      failure: { event: "post_clone", task: "setup", code: 7 },
    });
  });
});
