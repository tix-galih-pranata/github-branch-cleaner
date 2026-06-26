import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProtectedBranch, type DeleteResult } from "./branches";

export { PROTECTED_BRANCHES, isProtectedBranch } from "./branches";
export type { DeleteResult } from "./branches";

const GIT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export class GitError extends Error {
  stderr: string;
  constructor(message: string, stderr = "") {
    super(message);
    this.name = "GitError";
    this.stderr = stderr;
  }
}

interface RawResult {
  stdout: string;
  stderr: string;
  code: number | null;
  /** Set when the process could not be spawned at all (e.g. git missing). */
  spawnError?: NodeJS.ErrnoException;
}

/**
 * Runs git and resolves with stdout/stderr/exit-code instead of rejecting on a
 * non-zero exit. This lets callers parse output (e.g. push --porcelain) even
 * when git reports a partial failure. Only true spawn failures populate
 * spawnError.
 */
function runRaw(args: string[], cwd?: string): Promise<RawResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        // Never prompt interactively for credentials; fail fast so the request
        // returns an error rather than hanging on a password prompt.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
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

function ensureSpawned(result: RawResult): void {
  if (result.spawnError) {
    if (result.spawnError.code === "ENOENT") {
      throw new GitError("git executable not found on this machine");
    }
    throw new GitError(result.spawnError.message, result.stderr);
  }
}

function firstLine(text: string): string {
  return (
    (text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)[0] ?? ""
  );
}

/**
 * Validates a git remote URL. Because we run git via execFile (no shell), the
 * main risk is "argument injection" where a value starting with "-" is parsed
 * as a git option. We reject those and obviously malformed values.
 */
export function validateRemoteUrl(url: unknown): string {
  if (typeof url !== "string") {
    throw new GitError("Repository URL is required");
  }
  const trimmed = url.trim();
  if (!trimmed) {
    throw new GitError("Repository URL is required");
  }
  if (trimmed.startsWith("-")) {
    throw new GitError("Invalid repository URL");
  }
  if (/[\s\x00-\x1f]/.test(trimmed)) {
    throw new GitError("Invalid repository URL");
  }
  const isHttp = /^https?:\/\/.+/i.test(trimmed);
  const isSsh = /^ssh:\/\/.+/i.test(trimmed);
  const isScpLike = /^[^@\s]+@[^:\s]+:.+/.test(trimmed); // git@github.com:org/repo.git
  const isGitProto = /^git:\/\/.+/i.test(trimmed);
  if (!isHttp && !isSsh && !isScpLike && !isGitProto) {
    throw new GitError(
      "Unsupported repository URL. Use https://, ssh://, git@host:path, or git:// .",
    );
  }
  return trimmed;
}

/**
 * Validates a branch name for use as a `git push --delete` target. Prevents
 * argument injection and obviously invalid ref names.
 */
export function validateBranchName(name: unknown): string {
  if (typeof name !== "string") {
    throw new GitError("Invalid branch name");
  }
  const trimmed = name.trim();
  if (!trimmed || trimmed.startsWith("-")) {
    throw new GitError(`Invalid branch name: ${String(name)}`);
  }
  if (/[\s\x00-\x20~^:?*\[\\]/.test(trimmed)) {
    throw new GitError(`Invalid branch name: ${trimmed}`);
  }
  if (
    trimmed.includes("..") ||
    trimmed.endsWith(".lock") ||
    trimmed.endsWith("/")
  ) {
    throw new GitError(`Invalid branch name: ${trimmed}`);
  }
  return trimmed;
}

/** Lists remote branch names. Uses ls-remote, so no content is fetched. */
export async function lsRemoteHeads(url: unknown): Promise<string[]> {
  const safeUrl = validateRemoteUrl(url);
  const result = await runRaw(["ls-remote", "--heads", safeUrl]);
  ensureSpawned(result);
  if (result.code !== 0) {
    throw new GitError(
      firstLine(result.stderr) || "Failed to list remote branches",
      result.stderr,
    );
  }
  const branches: string[] = [];
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/\trefs\/heads\/(.+)$/);
    if (match) branches.push(match[1]);
  }
  return branches.sort((a, b) => a.localeCompare(b));
}

/** Resolves the remote's default branch (where HEAD points), or null. */
export async function lsRemoteDefault(url: unknown): Promise<string | null> {
  const safeUrl = validateRemoteUrl(url);
  const result = await runRaw(["ls-remote", "--symref", safeUrl, "HEAD"]);
  ensureSpawned(result);
  if (result.code !== 0) return null;
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Deletes the given branches on the remote in a single push using --porcelain
 * so we can attribute success/failure per branch. Never fetches content.
 */
export async function pushDelete(
  url: unknown,
  branches: unknown[],
): Promise<DeleteResult> {
  const safeUrl = validateRemoteUrl(url);
  const safeBranches = branches.map(validateBranchName);
  if (safeBranches.length === 0) {
    throw new GitError("No branches to delete");
  }

  const protectedHits = safeBranches.filter(isProtectedBranch);
  if (protectedHits.length > 0) {
    throw new GitError(
      `Refusing to delete protected branch(es): ${protectedHits.join(", ")}`,
    );
  }

  // `git push` must run inside a git repository, even when pushing to a URL and
  // even though deleting a remote ref needs nothing from the local repo. We use
  // an empty, throwaway repo so nothing is ever cloned, fetched, or checked out.
  const repoDir = await mkdtemp(join(tmpdir(), "branch-cleaner-"));
  try {
    const init = await runRaw(["init", "-q"], repoDir);
    ensureSpawned(init);
    if (init.code !== 0) {
      throw new GitError(
        firstLine(init.stderr) || "Failed to prepare temporary git repository",
        init.stderr,
      );
    }

    const result = await runRaw(
      ["push", "--porcelain", safeUrl, "--delete", ...safeBranches],
      repoDir,
    );
    ensureSpawned(result);

    return parsePorcelain(result.stdout, safeBranches, result.stderr);
  } finally {
    await rm(repoDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Parses `git push --porcelain` output. Each ref line is:
 *   <flag>\t<from>:<to>\t<summary>
 * For deletions <to> is refs/heads/<name>; flag "-" means deleted, "!" rejected.
 */
function parsePorcelain(
  stdout: string,
  branches: string[],
  stderr = "",
): DeleteResult {
  const deleted: string[] = [];
  const failed: { name: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.includes("refs/heads/")) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const flag = parts[0];
    const refField = parts[1];
    const summary = parts[2] ?? "";
    const match = refField.match(/refs\/heads\/(.+)$/);
    if (!match) continue;
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    if (flag === "-" || flag === " " || flag === "*" || flag === "+") {
      deleted.push(name);
    } else {
      failed.push({ name, reason: summary.trim() || "rejected" });
    }
  }

  // Any branch with no porcelain line is treated as failed so we never report a
  // deletion that did not actually happen.
  for (const name of branches) {
    if (!seen.has(name)) {
      failed.push({
        name,
        reason: firstLine(stderr) || "no status reported by git",
      });
    }
  }

  return { deleted, failed };
}
