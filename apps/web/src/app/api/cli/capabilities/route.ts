import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apps, db, memberships } from "@cira/db";
import { userFromRequest } from "@/lib/cli-session";
import { analyzeCapabilities } from "@/lib/capability-analyzer";
import { replaceCapabilities } from "@/lib/capabilities";

/**
 * Analysis is one model call over a whole repository summary, which is slower
 * than a page render and faster than a build. It runs while the deploy is
 * still going out, so it costs the developer no extra waiting.
 */
export const maxDuration = 300;

const method = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * The extractor's own output, re-validated at the edge.
 *
 * It arrives from a CLI on someone's laptop, so it is untrusted input like any
 * other, however deterministic the code that produced it.
 */
const summary = z.object({
  framework: z.literal("nextjs"),
  packageName: z.string().max(200).nullable(),
  dependencies: z.array(z.string().max(200)).max(200),
  routes: z
    .array(
      z.object({
        path: z.string().min(1).max(300),
        methods: z.array(method).min(1).max(5),
        file: z.string().max(500),
        dynamic: z.boolean(),
        doc: z.string().max(1000).nullable(),
        excerpt: z.string().max(4000),
      }),
    )
    .max(80),
  functions: z
    .array(
      z.object({
        name: z.string().max(200),
        file: z.string().max(500),
        signature: z.string().max(1000),
        doc: z.string().max(1000).nullable(),
        serverAction: z.boolean(),
      }),
    )
    .max(120),
  shapes: z
    .array(
      z.object({
        name: z.string().max(200),
        file: z.string().max(500),
        kind: z.enum(["interface", "type", "zod"]),
        text: z.string().max(3000),
      }),
    )
    .max(80),
  notes: z.array(z.string().max(500)).max(50),
});

const body = z.object({
  appId: z.string().min(1).max(64),
  summary,
});

/**
 * Analyze a just-deployed app and register what it can do.
 *
 * Called by `cira deploy` rather than triggered by the deployment, because the
 * source only exists on the developer's machine - Cira never keeps a copy.
 */
export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Bad request" },
      { status: 400 },
    );
  }

  const database = db();

  const [app] = await database
    .select()
    .from(apps)
    .where(eq(apps.id, parsed.data.appId))
    .limit(1);

  if (app === undefined) {
    return NextResponse.json({ error: "No such app." }, { status: 404 });
  }

  // Membership in the app's space, checked here rather than inferred from the
  // fact that a deploy just happened: an app id is not a right to describe it.
  const [membership] = await database
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.spaceId, app.spaceId)))
    .limit(1);

  if (membership === undefined) {
    return NextResponse.json({ error: "No such app." }, { status: 404 });
  }

  const analysis = await analyzeCapabilities(parsed.data.summary, {
    appName: app.name,
  });

  if (!analysis.ok) {
    // A deploy is not failed by an analysis that could not run. The app is
    // live; it simply has nothing registered yet.
    return NextResponse.json({ error: analysis.error }, { status: 502 });
  }

  // Written once and then left alone. A description someone has edited is a
  // human decision, and a later deploy re-running the analyzer is not a reason
  // to overwrite it - which is also why this checks the column rather than
  // tracking a flag nobody would remember to set.
  if (
    analysis.summary !== "" &&
    (app.description === null || app.description.trim() === "")
  ) {
    await database
      .update(apps)
      .set({ description: analysis.summary, updatedAt: new Date() })
      .where(eq(apps.id, app.id));
  }

  const counts = await replaceCapabilities({
    appId: app.id,
    spaceId: app.spaceId,
    detected: analysis.capabilities,
  });

  return NextResponse.json({
    detected: analysis.capabilities.map((c) => ({
      name: c.name,
      description: c.description,
      risk: c.risk,
    })),
    enabled: counts.enabled,
    review: counts.review,
  });
}
