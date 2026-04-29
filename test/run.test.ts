import { describe, expect, test } from "bun:test";
import type { Repo } from "../src/repos";
import { envWithoutFinalizer, filterReposByMatch, resolveCommand, shellQuote } from "../src/run";

describe("run", () => {
  test("configured task takes precedence over raw command", () => {
    expect(resolveCommand("status", ["--short"], { status: "git status" })).toBe(
      "git status --short",
    );
  });

  test("falls back to raw command when task is missing", () => {
    expect(resolveCommand("git status", [], {})).toBe("git status");
  });

  test("--match filters repositories by repo key regex", () => {
    const repos = [
      repo("github.com", "atian25", "projj"),
      repo("github.com", "eggjs", "egg"),
      repo("gitlab.com", "atian25", "notes"),
    ];

    expect(filterReposByMatch(repos, "^github\\.com/atian25/").map((item) => item.key)).toEqual([
      "github.com/atian25/projj",
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
