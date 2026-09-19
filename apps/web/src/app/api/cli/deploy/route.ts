import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_LIMITS, FRAMEWORKS, parseSchedule, settleMemory } from "@cira/core";
import { isSafeDockerfilePath } from "@cira/deploy";
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
  // Present when the folder carries a Dockerfile. Its port, when it declares
  // one, is what Cloud Run routes to and what the container sees as PORT.
  container: z
    .object({
      // Checked rather than trusted: it becomes an argument to a build, and a
      // path climbing out of the context would ask that build to read
      // something nobody uploaded.
      dockerfile: z.string().refine(isSafeDockerfilePath, "Not a usable Dockerfile path"),
      port: z.number().int().positive().max(65535).nullable(),
    })
    .nullable()
    .default(null),
  /**
   * The deployable halves of the repository, when the CLI found more than one.
   *
   * Absent from an older CLI, and from any repository that is one thing, which
   * is almost all of them - `container` above still describes that case and
   * still means what it meant.
   */
  services: z
    .array(
      z.object({
        slug: z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(24),
        sourcePath: z
          .string()
          .max(256)
          .refine((v) => !v.includes(".."), "Not a usable path"),
        dockerfile: z
          .string()
          .refine(isSafeDockerfilePath, "Not a usable Dockerfile path")
          .nullable(),
        port: z.number().int().positive().max(65535).nullable(),
        ingress: z.boolean(),
      }),
    )
    .max(8)
    .optional(),
  // Values pass straight through to the provider and are never stored; see
  // docs/secrets.md. Absent means "this app has none", which clears any the
  // app was previously deployed with.
  env: envSchema.optional(),
  /** Whether the repository has a web process. Absent from an older CLI: yes. */
  web: z.boolean().default(true),
  /** Workers and scheduled runs found in the repository. */
  processes: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z][a-z0-9-]{0,29}$/),
        kind: z.enum(["worker", "scheduled"]),
        command: z.string().trim().min(1).max(1000),
        schedule: z.string().max(100).nullable(),
        source: z.enum(["Procfile", "fly.toml", "GitHub Actions"]),
        /** MiB the repository asks for. Absent from an older CLI: the default. */
        memoryMiB: z.number().int().positive().max(1_048_576).nullable().default(null),
        service: z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(24),
      }),
    )
    .max(20)
    .default([]),
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
    container: parsed.data.container,
    services: parsed.data.services ?? null,
    env: parsed.data.env ?? {},
    web: parsed.data.web,
    // A timetable is taken only if Cira can run it; one it cannot is dropped
    // for a person to set, rather than refusing the whole deploy.
    // Memory is rounded to a size Cira offers, so what is recorded is what
    // Google is given; a repository that asks for none gets the default.
    processes: parsed.data.processes.map((p) => ({
      ...p,
      schedule: p.schedule !== null && parseSchedule(p.schedule).ok ? p.schedule : null,
      memoryMiB:
        p.memoryMiB === null ? null : settleMemory(p.memoryMiB, DEFAULT_LIMITS).memoryMiB,
    })),
  });

  if (!outcome.ok) {
    // A limit is not a malformed request, and saying so lets a client tell
    // "wait" from "fix what you sent".
    return NextResponse.json(
      { error: outcome.error },
      { status: outcome.limited === true ? 429 : 400 },
    );
  }

  return NextResponse.json(outcome);
}
