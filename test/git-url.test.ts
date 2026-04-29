import { describe, expect, test } from "bun:test";
import { parseRepoInput } from "../src/git-url";

describe("parseRepoInput", () => {
  test("parses short owner/repo input", () => {
    expect(parseRepoInput("atian25/projj", "github.com")).toEqual({
      host: "github.com",
      owner: "atian25",
      repo: "projj",
      cloneUrl: "git@github.com:atian25/projj.git",
      relPath: "github.com/atian25/projj",
    });
  });

  test("parses https input", () => {
    expect(
      parseRepoInput("https://github.com/eggjs/egg.git", "github.com"),
    ).toMatchObject({
      host: "github.com",
      owner: "eggjs",
      repo: "egg",
      cloneUrl: "https://github.com/eggjs/egg.git",
    });
  });

  test("parses scp-like ssh input", () => {
    expect(
      parseRepoInput("git@github.com:atian25/projj.git", "github.com"),
    ).toMatchObject({
      host: "github.com",
      owner: "atian25",
      repo: "projj",
    });
  });

  test("rejects scp-like ssh input with nested group owner", () => {
    expect(() =>
      parseRepoInput("git@gitlab.com:group/sub/repo.git", "github.com"),
    ).toThrow(/unsupported repository input|invalid repository input/);
  });

  test("rejects https input with nested group owner", () => {
    expect(() =>
      parseRepoInput("https://gitlab.com/group/sub/repo.git", "github.com"),
    ).toThrow(/unsupported repository input|invalid repository input/);
  });

  test("parses ssh url with port", () => {
    expect(
      parseRepoInput("ssh://git@git.example.com:2224/team/app.git", "github.com"),
    ).toMatchObject({
      host: "git.example.com",
      owner: "team",
      repo: "app",
    });
  });

  test("rejects short path traversal input", () => {
    expect(() => parseRepoInput("../..", "github.com")).toThrow(
      /unsupported repository input|invalid repository input/,
    );
  });

  test("rejects scp-like path traversal input", () => {
    expect(() => parseRepoInput("git@github.com:../..", "github.com")).toThrow(
      /unsupported repository input|invalid repository input/,
    );
  });

  test("rejects empty repository path segments", () => {
    expect(() => parseRepoInput("atian25//projj", "github.com")).toThrow(
      /unsupported repository input|invalid repository input/,
    );
  });

  test("rejects empty url path segments", () => {
    expect(() =>
      parseRepoInput("https://github.com/eggjs//egg", "github.com"),
    ).toThrow(/unsupported repository input|invalid repository input/);
  });

  test("rejects url path traversal before normalization", () => {
    expect(() =>
      parseRepoInput(
        "https://github.com/owner/repo/../../evil/repo",
        "github.com",
      ),
    ).toThrow(/unsupported repository input|invalid repository input/);
  });

  test("rejects encoded url path traversal before normalization", () => {
    expect(() =>
      parseRepoInput(
        "https://github.com/owner/repo/%2e%2e/evil/repo",
        "github.com",
      ),
    ).toThrow(/unsupported repository input|invalid repository input/);
  });

  test("normalizes github tree url to repository", () => {
    expect(
      parseRepoInput("https://github.com/eggjs/egg/tree/master", "github.com"),
    ).toMatchObject({
      host: "github.com",
      owner: "eggjs",
      repo: "egg",
      cloneUrl: "https://github.com/eggjs/egg.git",
    });
  });

  test("normalizes github issue url to repository", () => {
    expect(
      parseRepoInput("https://github.com/eggjs/egg/issues/1", "github.com"),
    ).toMatchObject({
      host: "github.com",
      owner: "eggjs",
      repo: "egg",
      cloneUrl: "https://github.com/eggjs/egg.git",
    });
  });

  test("normalizes gitlab tree url to repository", () => {
    expect(
      parseRepoInput(
        "https://gitlab.com/gitlab-org/gitlab/-/tree/master",
        "github.com",
      ),
    ).toMatchObject({
      host: "gitlab.com",
      owner: "gitlab-org",
      repo: "gitlab",
      cloneUrl: "https://gitlab.com/gitlab-org/gitlab.git",
    });
  });

  test("rejects gitlab nested group page url", () => {
    expect(() =>
      parseRepoInput(
        "https://gitlab.com/group/sub/repo/-/tree/master",
        "github.com",
      ),
    ).toThrow(/unsupported repository input|invalid repository input/);
  });

  test("normalizes gitlab issue url to repository", () => {
    expect(
      parseRepoInput(
        "https://gitlab.com/gitlab-org/gitlab/-/issues/1",
        "github.com",
      ),
    ).toMatchObject({
      host: "gitlab.com",
      owner: "gitlab-org",
      repo: "gitlab",
      cloneUrl: "https://gitlab.com/gitlab-org/gitlab.git",
    });
  });

  test("removes trailing slash from https input", () => {
    expect(
      parseRepoInput("https://github.com/eggjs/egg/", "github.com"),
    ).toMatchObject({
      host: "github.com",
      owner: "eggjs",
      repo: "egg",
    });
  });
});
