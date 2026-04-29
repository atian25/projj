import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export type Repo = {
  base: string;
  host: string;
  owner: string;
  name: string;
  path: string;
  key: string;
};

async function listVisibleDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function hasGitDir(path: string): Promise<boolean> {
  try {
    return (await stat(join(path, ".git"))).isDirectory();
  } catch {
    return false;
  }
}

function byPath(a: Repo, b: Repo): number {
  return a.path.localeCompare(b.path);
}

export async function scanRepos(baseDirs: string[]): Promise<Repo[]> {
  const repos: Repo[] = [];

  for (const base of baseDirs) {
    for (const host of await listVisibleDirs(base)) {
      const hostPath = join(base, host);
      for (const owner of await listVisibleDirs(hostPath)) {
        const ownerPath = join(hostPath, owner);
        for (const name of await listVisibleDirs(ownerPath)) {
          const path = join(ownerPath, name);
          if (!(await hasGitDir(path))) continue;
          repos.push({
            base,
            host,
            owner,
            name,
            path,
            key: `${host}/${owner}/${name}`,
          });
        }
      }
    }
  }

  return repos.sort(byPath);
}

function matchRank(repo: Repo, query: string): number | undefined {
  const needle = query.toLowerCase();
  const name = repo.name.toLowerCase();
  const ownerRepo = `${repo.owner}/${repo.name}`.toLowerCase();
  const key = repo.key.toLowerCase();

  if (name === needle) return 0;
  if (ownerRepo === needle) return 1;
  if (key === needle) return 2;
  if (name.includes(needle) || ownerRepo.includes(needle) || key.includes(needle)) return 3;
  return undefined;
}

export function findRepos(repos: Repo[], query?: string): Repo[] {
  const normalizedQuery = query?.trim();
  if (!normalizedQuery) return [...repos].sort(byPath);

  return repos
    .map((repo) => ({ repo, rank: matchRank(repo, normalizedQuery) }))
    .filter((item): item is { repo: Repo; rank: number } => item.rank !== undefined)
    .sort((a, b) => a.rank - b.rank || byPath(a.repo, b.repo))
    .map((item) => item.repo);
}
