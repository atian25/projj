export type RepoInfo = {
  host: string;
  owner: string;
  repo: string;
  cloneUrl: string;
  relPath: string;
};

type ParsedRepo = {
  host: string;
  owner: string;
  repo: string;
  cloneUrl: string;
};

type ParsedRepoPath = Pick<ParsedRepo, "owner" | "repo"> & {
  isNormalized?: boolean;
};

const WEB_REPO_PATH_SEGMENTS = new Set([
  "actions",
  "blob",
  "branches",
  "commit",
  "commits",
  "discussions",
  "issues",
  "pull",
  "pulls",
  "releases",
  "settings",
  "tags",
  "tree",
  "wiki",
]);

export function parseRepoInput(input: string, defaultPlatform: string): RepoInfo {
  const normalizedInput = input.trim();
  const parsed =
    parseShortRepoInput(normalizedInput, defaultPlatform) ??
    parseScpLikeInput(normalizedInput) ??
    parseUrlInput(normalizedInput);

  if (!parsed) {
    throw new Error(`unsupported repository input: ${input}`);
  }

  if (
    !isValidRepoSegment(parsed.host) ||
    !isValidRepoOwner(parsed.owner) ||
    !isValidRepoSegment(parsed.repo)
  ) {
    throw new Error(`invalid repository input: ${input}`);
  }

  return {
    ...parsed,
    relPath: `${parsed.host}/${parsed.owner}/${parsed.repo}`,
  };
}

function parseShortRepoInput(
  input: string,
  defaultPlatform: string,
): ParsedRepo | undefined {
  const parts = parsePathSegments(input);

  if (!parts || parts.length !== 2 || input.includes(":")) {
    return undefined;
  }

  const owner = parts[0];
  const rawRepo = parts[1];

  if (!owner || !rawRepo) {
    return undefined;
  }

  const repo = cleanRepoName(rawRepo);

  if (!owner || !repo) {
    return undefined;
  }

  return {
    host: defaultPlatform,
    owner,
    repo,
    cloneUrl: `git@${defaultPlatform}:${owner}/${repo}.git`,
  };
}

function parseScpLikeInput(input: string): ParsedRepo | undefined {
  const match = input.match(/^([^@/\s]+)@([^:/\s]+):(.+)$/);

  if (!match) {
    return undefined;
  }

  const host = match[2];
  const path = match[3];

  if (!host || !path) {
    return undefined;
  }

  const repoPath = parseExactRepoPath(path);

  if (!repoPath) {
    return undefined;
  }

  return {
    host,
    ...repoPath,
    cloneUrl: input,
  };
}

function parseUrlInput(input: string): ParsedRepo | undefined {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return undefined;
  }

  if (url.protocol !== "https:" && url.protocol !== "ssh:") {
    return undefined;
  }

  if (hasUnsafePathSegment(extractRawUrlPath(input))) {
    return undefined;
  }

  const repoPath = parseUrlRepoPath(url.pathname);

  if (!repoPath) {
    return undefined;
  }
  const { isNormalized, ...repo } = repoPath;

  return {
    host: url.hostname,
    ...repo,
    cloneUrl: isNormalized
      ? `https://${url.hostname}/${repo.owner}/${repo.repo}.git`
      : input,
  };
}

function parseExactRepoPath(path: string): ParsedRepoPath | undefined {
  const parts = parsePathSegments(path);

  if (!parts || parts.length !== 2) {
    return undefined;
  }

  const owner = parts[0];
  const rawRepo = parts[1];

  if (!owner || !rawRepo) {
    return undefined;
  }

  const repo = cleanRepoName(rawRepo);

  if (!owner || !repo) {
    return undefined;
  }

  return { owner, repo };
}

function parseUrlRepoPath(path: string): ParsedRepoPath | undefined {
  const parts = parsePathSegments(path);

  if (!parts || parts.length < 2) {
    return undefined;
  }

  const webRepoPath = parseWebRepoPath(parts);
  if (webRepoPath) return webRepoPath;

  if (parts.length !== 2) {
    return undefined;
  }

  const owner = parts[0];
  const rawRepo = parts[1];

  if (!owner || !rawRepo) {
    return undefined;
  }

  const repo = cleanRepoName(rawRepo);

  if (!isValidRepoOwner(owner) || !isValidRepoSegment(repo)) {
    return undefined;
  }

  return { owner, repo };
}

function parseWebRepoPath(parts: string[]): ParsedRepoPath | undefined {
  const gitlabMarkerIndex = parts.indexOf("-");
  if (gitlabMarkerIndex === 2 && isSupportedWebRepoPathSegment(parts[gitlabMarkerIndex + 1])) {
    return parseRepoPathFromParts(parts.slice(0, gitlabMarkerIndex), true);
  }

  if (isSupportedWebRepoPathSegment(parts[2])) {
    return parseRepoPathFromParts(parts.slice(0, 2), true);
  }

  return undefined;
}

function parseRepoPathFromParts(parts: string[], isNormalized: boolean): ParsedRepoPath | undefined {
  if (parts.length !== 2) return undefined;

  const owner = parts[0] ?? "";
  const repo = cleanRepoName(parts[1] ?? "");

  if (!isValidRepoOwner(owner) || !isValidRepoSegment(repo)) {
    return undefined;
  }

  return { owner, repo, isNormalized };
}

function isSupportedWebRepoPathSegment(segment: string | undefined): boolean {
  return Boolean(segment && WEB_REPO_PATH_SEGMENTS.has(segment));
}

function cleanRepoName(repo: string): string {
  return repo.replace(/\/+$/, "").replace(/\.git$/, "");
}

function parsePathSegments(path: string): string[] | undefined {
  const trimmedPath = path.replace(/^\/+|\/+$/g, "");

  if (!trimmedPath) {
    return undefined;
  }

  const parts = trimmedPath.split("/");

  if (parts.some((part) => part === "")) {
    return undefined;
  }

  if (parts.some(isUnsafePathSegment)) {
    return undefined;
  }

  return parts;
}

function isValidRepoSegment(segment: string): boolean {
  return (
    segment !== "" &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("/")
  );
}

function isValidRepoOwner(owner: string): boolean {
  return isValidRepoSegment(owner);
}

function extractRawUrlPath(input: string): string {
  const authorityStart = input.indexOf("://");

  if (authorityStart === -1) {
    return "";
  }

  const pathStart = input.indexOf("/", authorityStart + 3);

  if (pathStart === -1) {
    return "";
  }

  const pathEnd = input.slice(pathStart).search(/[?#]/);

  if (pathEnd === -1) {
    return input.slice(pathStart);
  }

  return input.slice(pathStart, pathStart + pathEnd);
}

function hasUnsafePathSegment(path: string): boolean {
  const parts = parsePathSegments(path);

  return parts === undefined
    ? path.length > 0
    : parts.some(isUnsafePathSegment);
}

function isUnsafePathSegment(segment: string): boolean {
  const decodedSegment = decodePathSegment(segment);

  return (
    segment === "." ||
    segment === ".." ||
    decodedSegment === undefined ||
    decodedSegment === "." ||
    decodedSegment === ".."
  );
}

function decodePathSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}
