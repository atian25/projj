import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { targetPathForRepo, pathExists, cloneRepo } from "../src/git";
import type { RepoInfo } from "../src/git-url";

const info: RepoInfo = {
  host: "github.com",
  owner: "atian25",
  repo: "projj",
  cloneUrl: "git@github.com:atian25/projj.git",
  relPath: "github.com/atian25/projj",
};

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "projj-git-"));
}

describe("git", () => {
  test("computes target path", () => {
    expect(targetPathForRepo("/Users/tz/projj", info)).toBe(
      join("/Users/tz/projj", "github.com", "atian25", "projj"),
    );
  });

  test("computes target path for gitlab repository", () => {
    expect(
      targetPathForRepo("/base", {
        host: "gitlab.com",
        owner: "group",
        repo: "repo",
        cloneUrl: "git@gitlab.com:group/repo.git",
        relPath: "gitlab.com/group/repo",
      }),
    ).toBe(join("/base", "gitlab.com", "group", "repo"));
  });

  test("checks whether a path exists", async () => {
    const dir = await tempDir();
    const existingPath = join(dir, "exists");
    const missingPath = join(dir, "missing");
    await mkdir(existingPath);

    await expect(pathExists(existingPath)).resolves.toBe(true);
    await expect(pathExists(missingPath)).resolves.toBe(false);
  });

  test("clones with an injectable runner", async () => {
    const dir = await tempDir();
    const targetPath = join(dir, "github.com", "atian25", "projj");
    const calls: Array<{ cmd: string[] }> = [];

    await cloneRepo(info.cloneUrl, targetPath, async (cmd) => {
      calls.push({ cmd });
      return { exitCode: 0 };
    });

    expect(calls).toEqual([{ cmd: ["git", "clone", info.cloneUrl, targetPath] }]);
    await expect(pathExists(dirname(targetPath))).resolves.toBe(true);
  });

  test("throws exit code when clone fails", async () => {
    const dir = await tempDir();
    const targetPath = join(dir, "github.com", "atian25", "projj");

    await expect(
      cloneRepo(info.cloneUrl, targetPath, async () => ({ exitCode: 7 })),
    ).rejects.toThrow("exit code 7");
  });

});
