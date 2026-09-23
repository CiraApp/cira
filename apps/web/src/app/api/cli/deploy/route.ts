import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DEFAULT_LIMITS,
  FRAMEWORKS,
  parseSchedule,
  settleAppMemory,
  settleMemory,
} from "@cira/core";
import { isSafeDockerfilePath } from "@cira/deploy";
import { userFromRequest } from "@/lib/cli-session";
import { deployToSpace } from "@/lib/deploy-service";
import { ENV_NAME, MAX_VARS, envSchema } from "@/lib/env-vars";

/**
 * Starting a deploy writes the service and every worker and scheduled run at
 * Google before it answers. At 60 seconds an app with many processes could be
 * cut off part-way, and stayed "deploying" with half of them written.
 */
export const maxDuration = 300;

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
  // docs/secrets.md. Variables to set: a name not sent keeps its value, so a
  // deploy from a machine with no `.env` changes nothing about them.
  env: envSchema.optional(),
  /** Variables to take away, by name. Only ever an explicit ask. */
  unset: z.array(z.string().regex(ENV_NAME)).max(MAX_VARS).default([]),
  /** Whether the repository has a web process. Absent from an older CLI: yes. */
  web: z.boolean().default(true),
  /** The command to run once per deploy before going live. Absent from an older CLI: none. */
  release: z.string().trim().min(1).max(1000).nullable().default(null),
  // Shown as written, so kept to one short line of printable text.
  sourceLabel: z
    .string()
    .trim()
    .max(120)
    .refine(
      (label) => [...label].every((c) => c >= " " && c !== "\u007f"),
      "A source label is one line of text",
    )
    .nullable()
    .default(null),
  /** MiB the repository gives its web process. Absent from an older CLI: none. */
  webMemoryMiB: z.number().int().positive().max(1_048_576).nullable().default(null),
  /**
   * A Postgres database for the app, set as this variable. Absent from an
   * older CLI, and from a deploy that did not ask: none is made.
   */
  database: z
    .object({ envName: z.string().regex(ENV_NAME).max(100) })
    .nullable()
    .default(null),
  /** A Redis cache for the app, set as this variable. Absent: none is made. */
  cache: z
    .object({ envName: z.string().regex(ENV_NAME).max(100) })
    .nullable()
    .default(null),
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
    sourceLabel: parsed.data.sourceLabel === "" ? null : parsed.data.sourceLabel,
    framework: parsed.data.framework,
    container: parsed.data.container,
    services: parsed.data.services ?? null,
    env: { set: parsed.data.env ?? {}, unset: parsed.data.unset },
    web: parsed.data.web,
    webMemoryMiB: settleAppMemory(parsed.data.webMemoryMiB).memoryMiB,
    release: parsed.data.release,
    database: parsed.data.database,
    cache: parsed.data.cache,
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
