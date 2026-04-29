import { describe, expect, test } from "bun:test";
import { interpretFzfResult } from "../src/select";
import type { Repo } from "../src/repos";

describe("select", () => {
  test("treats fzf cancel as cancelled instead of unavailable", () => {
    expect(interpretFzfResult(130, "", [repo("projj")])).toEqual({ kind: "cancelled" });
  });

  test("resolves selected fzf path to repo", () => {
    const selected = repo("projj");

    expect(interpretFzfResult(0, `github.com/atian25/projj\t${selected.path}\n`, [selected])).toEqual({
      kind: "selected",
      repo: selected,
    });
  });
});

function repo(name: string): Repo {
  return {
    base: "/tmp/base",
    host: "github.com",
    owner: "atian25",
    name,
    path: `/tmp/base/github.com/atian25/${name}`,
    key: `github.com/atian25/${name}`,
  };
}
