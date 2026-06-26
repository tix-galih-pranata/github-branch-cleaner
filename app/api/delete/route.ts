import { NextResponse } from "next/server";
import { lsRemoteDefault, pushDelete } from "@/lib/git";
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

  const { url, branches } = (body ?? {}) as {
    url?: unknown;
    branches?: unknown;
  };

  if (!Array.isArray(branches) || branches.length === 0) {
    return NextResponse.json(
      { error: "No branches selected for deletion" },
      { status: 400 },
    );
  }

  const names = branches.map((b) => String(b));

  try {
    // Hard guard: never allow deleting the remote's default branch, even if the
    // client somehow requested it.
    const defaultBranch = await lsRemoteDefault(url).catch(() => null);
    if (defaultBranch && names.includes(defaultBranch)) {
      return NextResponse.json(
        { error: `Refusing to delete the default branch "${defaultBranch}".` },
        { status: 400 },
      );
    }

    const result = await pushDelete(url, names);
    return NextResponse.json(result);
  } catch (err) {
    return gitErrorResponse(err, "Unexpected error while deleting branches");
  }
}
