import { NextResponse } from "next/server";
import { GitError } from "./git";
import { GhError } from "./gh";

/**
 * Maps an error thrown by the git/gh helpers to a JSON response: GitError and
 * GhError become a 400 with their message/detail, anything else a generic 500.
 */
export function gitErrorResponse(err: unknown, fallback: string): NextResponse {
  if (err instanceof GitError) {
    return NextResponse.json(
      { error: err.message, detail: err.stderr || undefined },
      { status: 400 },
    );
  }
  if (err instanceof GhError) {
    return NextResponse.json(
      { error: err.message, detail: err.detail || undefined },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
