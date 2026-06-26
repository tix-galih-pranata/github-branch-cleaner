import { NextResponse } from "next/server";
import { lsRemoteDefault, lsRemoteHeads } from "@/lib/git";
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

  const url = (body as { url?: unknown } | null)?.url;

  try {
    const [branches, defaultBranch] = await Promise.all([
      lsRemoteHeads(url),
      lsRemoteDefault(url).catch(() => null),
    ]);
    return NextResponse.json({ branches, defaultBranch });
  } catch (err) {
    return gitErrorResponse(err, "Unexpected error while listing branches");
  }
}
