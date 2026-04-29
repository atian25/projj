import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { shellInit, writeCdFinalizer } from "../src/shell";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "projj-shell-"));
}

describe("shell", () => {
  test("writes cd finalizer when PROJJ_FINALIZER_FILE is set", async () => {
    const dir = await tempDir();
    const file = join(dir, "finalizer");

    const written = await writeCdFinalizer("/tmp/repo", { PROJJ_FINALIZER_FILE: file });

    expect(written).toBe(true);
    await expect(readFile(file, "utf8")).resolves.toBe("cd:/tmp/repo\n");
  });

  test("does not write finalizer when PROJJ_FINALIZER_FILE is missing", async () => {
    await expect(writeCdFinalizer("/tmp/repo", {})).resolves.toBe(false);
  });

  test("zsh init includes finalizer wrapper", () => {
    const script = shellInit("zsh");

    expect(script).toContain("PROJJ_FINALIZER_FILE");
    expect(script).toContain("cd:");
  });

  test("bash init includes finalizer wrapper", () => {
    const script = shellInit("bash");

    expect(script).toContain("PROJJ_FINALIZER_FILE");
    expect(script).toContain("cd:");
  });

  test("fish init includes finalizer wrapper", () => {
    const script = shellInit("fish");

    expect(script).toContain("PROJJ_FINALIZER_FILE");
    expect(script).toContain("cd:");
    expect(script).toContain('command env PROJJ_FINALIZER_FILE="$__projj_finalizer" projj $argv');
    expect(script).not.toContain('env PROJJ_FINALIZER_FILE="$__projj_finalizer" command projj');
  });
});
