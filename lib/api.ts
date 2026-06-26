import { NextResponse } from "next/server";
import { GitError } from "./git";

/**
 * Maps an error thrown by the git helpers to a JSON response: GitError becomes
 * a 400 with its message/stderr, anything else a generic 500.
 */
export function gitErrorResponse(err: unknown, fallback: string): NextResponse {
  if (err instanceof GitError) {
    return NextResponse.json(
      { error: err.message, detail: err.stderr || undefined },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
