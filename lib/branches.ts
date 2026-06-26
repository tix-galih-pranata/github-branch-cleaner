// Client-safe branch helpers shared by the server (lib/git.ts) and the client
// page. This module must stay free of Node-only imports so it can be bundled
// into the client without pulling in node:child_process.

/**
 * Branches that must never be deleted, regardless of what the client requests.
 * Matched by exact name, case-insensitively. Namespaced branches such as
 * "develop/demand" or "release/1.2" are NOT protected and can be deleted.
 */
export const PROTECTED_BRANCHES = [
  "master",
  "main",
  "develop",
  "release",
  "staging",
] as const;

export function isProtectedBranch(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return PROTECTED_BRANCHES.some((p) => lower === p);
}

export interface DeleteResult {
  deleted: string[];
  failed: { name: string; reason: string }[];
}
