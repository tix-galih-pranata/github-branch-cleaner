import { execFile } from "node:child_process";
import { validateBranchName } from "./git";

const GH_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export class GhError extends Error {
  detail: string;
  constructor(message: string, detail = "") {
    super(message);
    this.name = "GhError";
    this.detail = detail;
  }
}

interface RawResult {
  stdout: string;
  stderr: string;
  code: number | null;
  spawnError?: NodeJS.ErrnoException;
}

/**
 * Runs the gh CLI and resolves with stdout/stderr/exit-code. This module only
 * ever calls `gh api ...` (plus auth/version checks): pure REST against GitHub,
 * so no branch content is ever fetched, cloned, or checked out locally.
 */
function runGh(args: string[]): Promise<RawResult> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      args,
      {
        timeout: GH_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      },
      (error, stdout, stderr) => {
        const err = error as (Error & { code?: number | string }) | null;
        const isSpawnError = !!err && typeof err.code === "string";
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
          spawnError: isSpawnError ? (err as NodeJS.ErrnoException) : undefined,
        });
      },
    );
  });
}

function firstLine(text: string): string {
  return (
    (text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)[0] ?? ""
  );
}

/** Turns a gh failure into a GhError with the most useful message we can find. */
function ghFailure(result: RawResult): GhError {
  if (result.spawnError) {
    if (result.spawnError.code === "ENOENT") {
      return new GhError(
        "gh CLI not found. Install GitHub CLI and run `gh auth login`.",
      );
    }
    return new GhError(result.spawnError.message);
  }
  // gh api prints the API error body (often JSON with a "message") to stdout,
  // and CLI/auth errors to stderr.
  const blob = result.stdout || result.stderr;
  try {
    const parsed = JSON.parse(blob);
    if (parsed && typeof parsed.message === "string") {
      return new GhError(parsed.message, blob);
    }
  } catch {
    // not JSON; fall through to plain-text handling
  }
  const stderr = result.stderr.toLowerCase();
  if (stderr.includes("not logged") || stderr.includes("gh auth login")) {
    return new GhError("gh is not authenticated. Run `gh auth login`.", result.stderr);
  }
  return new GhError(
    firstLine(result.stderr) || firstLine(result.stdout) || "gh command failed",
    result.stderr,
  );
}

function runGhJson<T>(args: string[]): Promise<T> {
  return runGh(args).then((result) => {
    if (result.spawnError || result.code !== 0) {
      throw ghFailure(result);
    }
    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      throw new GhError("Could not parse gh output as JSON", result.stdout);
    }
  });
}

/** Normalizes a repo input (URL or "owner/repo") to the "owner/repo" slug. */
export function parseRepoSlug(input: unknown): string {
  if (typeof input !== "string") {
    throw new GhError("Repository is required");
  }
  let s = input.trim();
  if (!s) throw new GhError("Repository is required");

  // git@github.com:owner/repo(.git)
  const scp = s.match(/^[^@\s]+@[^:\s]+:(.+)$/);
  if (scp) s = scp[1];
  // https://github.com/owner/repo(.git) or ssh://.../owner/repo
  const url = s.match(/^(?:https?|ssh|git):\/\/[^/]+\/(.+)$/i);
  if (url) s = url[1];

  s = s.replace(/\.git$/i, "").replace(/\/+$/, "");
  const m = s.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!m) {
    throw new GhError(
      "Invalid repository. Use owner/repo or a GitHub URL.",
    );
  }
  return `${m[1]}/${m[2]}`;
}

export function validateSha(sha: unknown): string {
  if (typeof sha !== "string" || !/^[0-9a-f]{7,40}$/i.test(sha.trim())) {
    throw new GhError("Invalid commit SHA");
  }
  return sha.trim();
}

export interface ForcePushEvent {
  before: string;
  after: string;
  ref: string;
  branch: string;
  actor: string;
  timestamp: string;
}

interface RawActivity {
  before?: string;
  after?: string;
  ref?: string;
  timestamp?: string;
  actor?: { login?: string } | null;
}

/**
 * Lists force-push events for a repo (optionally a single branch). Returns
 * metadata only - the `before` SHA is the pre-force recovery target.
 */
export async function listForcePushEvents(
  repo: string,
  branch?: string,
): Promise<ForcePushEvent[]> {
  const args = [
    "api",
    "-X",
    "GET",
    `repos/${repo}/activity`,
    "-f",
    "activity_type=force_push",
    "-f",
    "direction=desc",
    "-f",
    "per_page=30",
  ];
  if (branch && branch.trim()) {
    const safeBranch = validateBranchName(branch);
    args.push("-f", `ref=refs/heads/${safeBranch}`);
  }

  const raw = await runGhJson<RawActivity[]>(args);
  return (Array.isArray(raw) ? raw : [])
    .filter(
      (e): e is RawActivity & { before: string; after: string } =>
        Boolean(e.before && e.after),
    )
    .map((e) => ({
      before: e.before,
      after: e.after,
      ref: e.ref ?? "",
      branch: (e.ref ?? "").replace(/^refs\/heads\//, ""),
      actor: e.actor?.login ?? "unknown",
      timestamp: e.timestamp ?? "",
    }));
}

export interface RecoverResult {
  mode: "new" | "inplace";
  ref: string;
  sha: string;
  url: string;
}

interface RawRef {
  ref?: string;
  object?: { sha?: string };
}

/** Non-destructive recovery: creates a new ref pointing at the recovered SHA. */
export async function createRecoveryRef(
  repo: string,
  newBranch: unknown,
  sha: unknown,
): Promise<RecoverResult> {
  const safeBranch = validateBranchName(newBranch);
  const safeSha = validateSha(sha);
  const data = await runGhJson<RawRef>([
    "api",
    "-X",
    "POST",
    `repos/${repo}/git/refs`,
    "-f",
    `ref=refs/heads/${safeBranch}`,
    "-f",
    `sha=${safeSha}`,
  ]);
  return {
    mode: "new",
    ref: data.ref ?? `refs/heads/${safeBranch}`,
    sha: data.object?.sha ?? safeSha,
    url: `https://github.com/${repo}/tree/${safeBranch}`,
  };
}

/** In-place recovery: force-moves an existing branch ref back to the SHA. */
export async function forceUpdateRef(
  repo: string,
  branch: unknown,
  sha: unknown,
): Promise<RecoverResult> {
  const safeBranch = validateBranchName(branch);
  const safeSha = validateSha(sha);
  const data = await runGhJson<RawRef>([
    "api",
    "-X",
    "PATCH",
    `repos/${repo}/git/refs/heads/${safeBranch}`,
    "-f",
    `sha=${safeSha}`,
    "-F",
    "force=true",
  ]);
  return {
    mode: "inplace",
    ref: data.ref ?? `refs/heads/${safeBranch}`,
    sha: data.object?.sha ?? safeSha,
    url: `https://github.com/${repo}/tree/${safeBranch}`,
  };
}
