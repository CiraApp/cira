import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apps, db, spaces } from "@cira/db";
import { userManages } from "@/lib/app-rights";
import { userFromRequest } from "@/lib/cli-session";
import { tearDownApp } from "@/lib/app-teardown";
import { record } from "@/lib/change-record";

/**
 * Take an app down from a terminal.
 *
 * The same teardown the app's settings page runs, reached the other way. Both
 * doors have to lead to the same place: a removal that differs by where it was
 * started from is one that leaves different things behind depending on the day.
 *
 * Managing rights, not membership. Deploying a new app into a space is
 * something any member may do; changing or removing one is for its managers.
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
  const allowed = found !== undefined && (await userManages(user, found.app));

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

  // The same record the app's page writes when it is deleted there: taking an
  // app away from a company is a change to it, whichever door it went through.
  await record({
    spaceId: found.spaceId,
    kind: "app-deleted",
    actor: user.name,
    actorUserId: user.id,
    subject: found.app.name,
  });

  return NextResponse.json({ removed: found.app.name, images: outcome.images });
}
