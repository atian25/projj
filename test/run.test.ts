import { describe, expect, test } from "bun:test";
import type { Repo } from "../src/repos";
import {
  envWithoutFinalizer,
  filterReposBySelector,
  resolveCommand,
  runShellCommand,
  shellQuote,
} from "../src/run";

describe("run", () => {
  test("configured task takes precedence over raw command", () => {
    expect(resolveCommand("status", ["--short"], { status: "git status" })).toBe(
      "git status --short",
    );
  });

  test("falls back to raw command when task is missing", () => {
    expect(resolveCommand("git status", [], {})).toBe("git status");
  });

  test("--filter matches repository selectors", () => {
    const repos = [
      repo("github.com", "atian25", "projj"),
      repo("github.com", "eggjs", "egg"),
      repo("gitlab.com", "atian25", "notes"),
    ];

    expect(filterReposBySelector(repos, "projj").map((item) => item.key)).toEqual([
      "github.com/atian25/projj",
    ]);
    expect(filterReposBySelector(repos, "atian25/*").map((item) => item.key)).toEqual([
      "github.com/atian25/projj",
      "gitlab.com/atian25/notes",
    ]);
    expect(filterReposBySelector(repos, "GITHUB.COM/EGGJS/*").map((item) => item.key)).toEqual([
      "github.com/eggjs/egg",
    ]);
  });

  test("shellQuote safely handles spaces and single quotes", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
    expect(shellQuote("it's ok")).toBe("'it'\\''s ok'");
  });

  test("run command environment excludes shell finalizer file", () => {
    const env = envWithoutFinalizer({
      PROJJ_FINALIZER_FILE: "/tmp/f",
      PATH: "x",
    });

    expect(env.PROJJ_FINALIZER_FILE).toBeUndefined();
    expect(env.PATH).toBe("x");
  });

  test("run shell command merges extra environment", async () => {
    const calls: Array<{ command: string; cwd: string; env: NodeJS.ProcessEnv }> = [];
    const code = await runShellCommand("echo ok", "/repo", {
      env: { PROJJ_EVENT: "post_clone" },
      baseEnv: {
        PATH: "/bin",
        PROJJ_FINALIZER_FILE: "/tmp/finalizer",
      },
      spawn: (command, options) => {
        calls.push({ command, cwd: options.cwd, env: options.env });
        return {
          on(event: "error" | "close", callback: (() => void) | ((code: number | null) => void)) {
            if (event === "close") callback(0);
            return this;
          },
        };
      },
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      {
        command: "echo ok",
        cwd: "/repo",
        env: {
          PATH: "/bin",
          PROJJ_EVENT: "post_clone",
        },
      },
    ]);
  });
});

function repo(host: string, owner: string, name: string): Repo {
  const base = "/tmp/base";
  return {
    base,
    host,
    owner,
    name,
    path: `${base}/${host}/${owner}/${name}`,
    key: `${host}/${owner}/${name}`,
  };
}
