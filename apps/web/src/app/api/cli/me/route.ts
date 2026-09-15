import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, memberships, spaces } from "@cira/db";
import { userFromRequest } from "@/lib/cli-session";

/** Who am I, and which spaces can I deploy to? */
export async function GET(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const rows = await db()
    .select({ slug: spaces.slug, name: spaces.name, role: memberships.role })
    .from(memberships)
    .innerJoin(spaces, eq(spaces.id, memberships.spaceId))
    .where(eq(memberships.userId, user.id));

  return NextResponse.json({
    user: { name: user.name, email: user.email },
    spaces: rows,
  });
}
