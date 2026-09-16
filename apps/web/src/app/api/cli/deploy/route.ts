import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromRequest } from "@/lib/cli-session";
import { deployToSpace } from "@/lib/deploy-service";
import { envSchema } from "@/lib/env-vars";

export const maxDuration = 60;

const body = z.object({
  spaceSlug: z.string().min(1).max(64),
  appName: z.string().trim().min(1).max(60),
  appId: z.string().min(1).max(64).nullable().optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        size: z.number().int().nonnegative(),
        sha: z.string().regex(/^[0-9a-f]{40}$/),
      }),
    )
    .min(1)
    .max(5000),
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
    files: parsed.data.files,
    env: parsed.data.env ?? {},
  });

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }

  return NextResponse.json(outcome);
}
