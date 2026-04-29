import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findRepos, scanRepos } from "../src/repos";

async function tempDir(): Promise<string> {
  const dir = await Bun.$`mktemp -d`.text();
  return dir.trim();
}

function byRepoPath(a: string, b: string): number {
  return a.localeCompare(b);
}

async function createRepo(base: string, host: string, owner: string, name: string): Promise<string> {
  const path = join(base, host, owner, name);
  await mkdir(join(path, ".git"), { recursive: true });
  return path;
}

async function createDir(base: string, host: string, owner: string, name: string): Promise<string> {
  const path = join(base, host, owner, name);
  await mkdir(path, { recursive: true });
  return path;
}

describe("repos", () => {
  test("only recognizes base/host/owner/repo/.git", async () => {
    const base = await tempDir();
    const repoPath = await createRepo(base, "github.com", "atian25", "projj");
    await mkdir(join(base, "github.com", "atian25", "nested", "projj", ".git"), {
      recursive: true,
    });

    await expect(scanRepos([base])).resolves.toEqual([
      {
        base,
        host: "github.com",
        owner: "atian25",
        name: "projj",
        path: repoPath,
        key: "github.com/atian25/projj",
      },
    ]);
  });

  test("skips directories without .git", async () => {
    const base = await tempDir();
    await createDir(base, "github.com", "atian25", "projj");
    const repoPath = await createRepo(base, "github.com", "eggjs", "egg");

    expect((await scanRepos([base])).map((repo) => repo.path)).toEqual([repoPath]);
  });

  test("skips hidden host, owner, and repo directories", async () => {
    const base = await tempDir();
    const repoPath = await createRepo(base, "github.com", "atian25", "projj");
    await createRepo(base, ".github.com", "atian25", "hidden-host");
    await createRepo(base, "github.com", ".atian25", "hidden-owner");
    await createRepo(base, "github.com", "atian25", ".hidden-repo");

    expect((await scanRepos([base])).map((repo) => repo.path)).toEqual([repoPath]);
  });

  test("repo name exact match is preferred over substring matches", () => {
    const repos = [
      repo("/tmp/base", "github.com", "atian25", "projj-tools"),
      repo("/tmp/base", "github.com", "eggjs", "projj"),
      repo("/tmp/base", "github.com", "atian25", "my-projj"),
    ];

    expect(findRepos(repos, "projj").map((item) => item.key)).toEqual([
      "github.com/eggjs/projj",
      "github.com/atian25/my-projj",
      "github.com/atian25/projj-tools",
    ]);
  });

  test("owner/repo matching is case insensitive", () => {
    const repos = [
      repo("/tmp/base", "github.com", "atian25", "projj"),
      repo("/tmp/base", "github.com", "eggjs", "egg"),
    ];

    expect(findRepos(repos, "ATIAN25/PROJJ").map((item) => item.key)).toEqual([
      "github.com/atian25/projj",
    ]);
  });

  test("returns all repositories sorted by path when query is empty", async () => {
    const base = await tempDir();
    const toolsPath = await createRepo(base, "github.com", "atian25", "projj-tools");
    const eggPath = await createRepo(base, "github.com", "eggjs", "egg");
    const projjPath = await createRepo(base, "github.com", "atian25", "projj");

    expect((await scanRepos([base])).map((repo) => repo.path)).toEqual([
      projjPath,
      toolsPath,
      eggPath,
    ].sort(byRepoPath));
  });

  test("sorts repositories from multiple bases by path", async () => {
    const baseB = await tempDir();
    const baseA = await tempDir();
    const pathB = await createRepo(baseB, "github.com", "eggjs", "egg");
    const pathA = await createRepo(baseA, "github.com", "atian25", "projj");

    expect((await scanRepos([baseB, baseA])).map((repo) => repo.path)).toEqual([
      pathA,
      pathB,
    ].sort(byRepoPath));
  });

  test("returns empty results for missing bases", async () => {
    const base = await tempDir();

    await expect(scanRepos([join(base, "missing")])).resolves.toEqual([]);
  });
});

function repo(base: string, host: string, owner: string, name: string) {
  return {
    base,
    host,
    owner,
    name,
    path: join(base, host, owner, name),
    key: `${host}/${owner}/${name}`,
  };
}
