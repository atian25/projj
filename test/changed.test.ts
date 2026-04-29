import { describe, expect, test } from "bun:test";
import { getRepoChangeStatus } from "../src/changed";

describe("changed", () => {
  test("reports changed when git status has output", async () => {
    const status = await getRepoChangeStatus("/repo", {
      run: async () => ({ exitCode: 0, stdout: " M src/index.ts\n" }),
    });

    expect(status).toEqual({ kind: "changed" });
  });

  test("reports clean when git status output is empty", async () => {
    const status = await getRepoChangeStatus("/repo", {
      run: async () => ({ exitCode: 0, stdout: "" }),
    });

    expect(status).toEqual({ kind: "clean" });
  });

  test("reports failure when git status exits non-zero", async () => {
    const status = await getRepoChangeStatus("/repo", {
      run: async () => ({ exitCode: 128, stdout: "" }),
    });

    expect(status).toEqual({ kind: "error", exitCode: 128 });
  });
});
