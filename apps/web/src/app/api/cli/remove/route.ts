import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apps, db, memberships, spaces } from "@cira/db";
import { canManageApp } from "@cira/core";
import { userFromRequest } from "@/lib/cli-session";
import { tearDownApp } from "@/lib/app-teardown";

/**
 * Take an app down from a terminal.
 *
 * The same teardown the app's settings page runs, reached the other way. Both
 * doors have to lead to the same place: a removal that differs by where it was
 * started from is one that leaves different things behind depending on the day.
 *
 * Managing rights, not membership. Deploying into a space is something any
 * member may do; removing what someone else deployed is not.
 */
export const maxDuration = 120;

const body = z.object({
  spaceSlug: z.string().min(1).max(64),
  appSlug: z.string().min(1).max(64),
  /** The app's name, typed back. The confirmation lives with the person. */
  confirm: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const database = db();
  const [found] = await database
    .select({ app: apps, spaceId: spaces.id })
    .from(apps)
    .innerJoin(spaces, eq(spaces.id, apps.spaceId))
    .where(
      and(eq(spaces.slug, parsed.data.spaceSlug), eq(apps.slug, parsed.data.appSlug)),
    )
    .limit(1);

  // Not being able to see it and not being allowed to remove it give the same
  // answer, so this cannot be used to find out which apps exist.
  const mine = await database
    .select({ id: memberships.id, role: memberships.role, spaceId: memberships.spaceId })
    .from(memberships)
    .where(eq(memberships.userId, user.id));

  const allowed =
    found !== undefined &&
    canManageApp({
      userId: user.id,
      app: found.app,
      memberships: mine.map((m) => ({
        id: m.id,
        userId: user.id,
        spaceId: m.spaceId,
        role: m.role,
      })),
    });

  if (!allowed || found === undefined) {
    return NextResponse.json({ error: "No such app" }, { status: 404 });
  }

  if (parsed.data.confirm.trim() !== found.app.name.trim()) {
    return NextResponse.json(
      { error: "That name does not match, so nothing was deleted." },
      { status: 400 },
    );
  }

  const outcome = await tearDownApp(found.app);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: 502 });
  }

  return NextResponse.json({ removed: found.app.name, images: outcome.images });
}
