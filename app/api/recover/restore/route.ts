import { NextResponse } from "next/server";
import { createRecoveryRef, forceUpdateRef, parseRepoSlug } from "@/lib/gh";
import { gitErrorResponse } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { repo, sha, mode, branch } = (body ?? {}) as {
    repo?: unknown;
    sha?: unknown;
    mode?: unknown;
    branch?: unknown;
  };

  if (mode !== "new" && mode !== "inplace") {
    return NextResponse.json(
      { error: 'Invalid mode. Use "new" or "inplace".' },
      { status: 400 },
    );
  }
  if (typeof branch !== "string" || !branch.trim()) {
    return NextResponse.json(
      { error: "A branch name is required" },
      { status: 400 },
    );
  }

  try {
    const slug = parseRepoSlug(repo);
    const result =
      mode === "new"
        ? await createRecoveryRef(slug, branch, sha)
        : await forceUpdateRef(slug, branch, sha);
    return NextResponse.json(result);
  } catch (err) {
    return gitErrorResponse(err, "Unexpected error while restoring branch");
  }
}
