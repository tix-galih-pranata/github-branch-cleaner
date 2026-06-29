import { NextResponse } from "next/server";
import { listForcePushEvents, parseRepoSlug } from "@/lib/gh";
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

  const { repo, branch } = (body ?? {}) as {
    repo?: unknown;
    branch?: unknown;
  };

  try {
    const slug = parseRepoSlug(repo);
    const events = await listForcePushEvents(
      slug,
      typeof branch === "string" ? branch : undefined,
    );
    return NextResponse.json({ repo: slug, events });
  } catch (err) {
    return gitErrorResponse(err, "Unexpected error while listing force-push events");
  }
}
