import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Repo } from "./repos";

type FzfResult =
  | { kind: "selected"; repo: Repo }
  | { kind: "unavailable" }
  | { kind: "cancelled" };

function isTty(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

export function interpretFzfResult(
  code: number | null,
  selected: string,
  repos: Repo[],
): FzfResult {
  if (code !== 0) return { kind: "cancelled" };

  const path = selected.trimEnd().split("\t").at(-1);
  const repo = repos.find((item) => item.path === path);
  return repo ? { kind: "selected", repo } : { kind: "cancelled" };
}

async function runFzf(repos: Repo[]): Promise<FzfResult> {
  const lines = repos.map((repo) => `${repo.key}\t${repo.path}`).join("\n");

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: FzfResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn("fzf", ["--with-nth=1", "--delimiter=\t"], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    let selected = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      selected += chunk;
    });
    child.on("error", () => finish({ kind: "unavailable" }));
    child.on("close", (code) => {
      finish(interpretFzfResult(code, selected, repos));
    });

    child.stdin.end(`${lines}\n`);
  });
}

async function promptNumbered(repos: Repo[]): Promise<Repo | null> {
  if (!isTty()) return null;

  repos.forEach((repo, index) => {
    output.write(`${index + 1}) ${repo.key}  ${repo.path}\n`);
  });

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Select repo: ");
    const index = Number.parseInt(answer.trim(), 10) - 1;
    return repos[index] ?? null;
  } finally {
    rl.close();
  }
}

export async function selectRepo(repos: Repo[]): Promise<Repo | null> {
  if (repos.length === 0) return null;
  if (repos.length === 1) return repos[0] ?? null;
  if (!isTty()) return null;

  const fzfResult = await runFzf(repos);
  if (fzfResult.kind === "selected") return fzfResult.repo;
  if (fzfResult.kind === "cancelled") return null;

  return promptNumbered(repos);
}
