import { NextResponse } from "next/server";
import { roleAtLeast } from "@cira/core";
import { NotFoundError, requireSpaceMember } from "@/lib/authz";
import { exportSpace } from "@/lib/space-export";

/**
 * Everything Cira holds about this space, as a file.
 *
 * A route rather than a button that builds it in the browser, so it is one
 * link, and so what leaves is exactly what the server would answer to the
 * person asking. Admins and owners: it names every person in the company.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ spaceSlug: string }> },
) {
  const { spaceSlug } = await params;
  try {
    const ctx = await requireSpaceMember(spaceSlug);
    if (!roleAtLeast(ctx.role, "admin")) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    const exported = await exportSpace(ctx.space.id);
    if (exported === null) return NextResponse.json({ error: "Gone" }, { status: 404 });

    const day = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(exported, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="cira-${ctx.space.slug}-${day}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw error;
  }
}
