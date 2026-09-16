import { NextResponse } from "next/server";
import { z } from "zod";
import { FRAMEWORKS } from "@cira/core";
import { userFromRequest } from "@/lib/cli-session";
import { deployToSpace } from "@/lib/deploy-service";
import { envSchema } from "@/lib/env-vars";

export const maxDuration = 60;

const body = z.object({
  spaceSlug: z.string().min(1).max(64),
  appName: z.string().trim().min(1).max(60),
  appId: z.string().min(1).max(64).nullable().optional(),
  // Names an archive this user already uploaded. The bytes never came through
  // Cira; this is the receipt for them.
  sourceId: z.string().regex(/^src_[0-9a-f]{32}$/),
  framework: z.enum(FRAMEWORKS).default("unknown"),
  // Values pass straight through to the provider and are never stored; see
  // docs/secrets.md. Absent means "this app has none", which clears any the
  // app was previously deployed with.
  env: envSchema.optional(),
});

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

  const outcome = await deployToSpace({
    user,
    spaceSlug: parsed.data.spaceSlug,
    appName: parsed.data.appName,
    appId: parsed.data.appId ?? null,
    sourceId: parsed.data.sourceId,
    framework: parsed.data.framework,
    env: parsed.data.env ?? {},
  });

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }

  return NextResponse.json(outcome);
}
