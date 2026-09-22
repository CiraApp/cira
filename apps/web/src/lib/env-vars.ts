import "server-only";

import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { appEnvVars, db } from "@cira/db";
import { newId, type EnvChange } from "@cira/core";

/**
 * Environment variables on the way to a deployment.
 *
 * Cira is a conduit, not a vault: a value passes through one request and is
 * never written down. What is recorded here is the fact of a variable - name,
 * fingerprint, who set it - so the app page can show what is configured. See
 * docs/secrets.md.
 */

/** Deliberately tight. A deploy request is not a file upload. */
export const MAX_VARS = 100;
export const MAX_VALUE_BYTES = 4096;
export const MAX_TOTAL_BYTES = 64 * 1024;

/** What a shell and a build both accept as a name. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const envSchema = z
  .record(z.string().regex(ENV_NAME, "That is not a usable variable name."), z.string())
  .refine((env) => Object.keys(env).length <= MAX_VARS, {
    message: `An app can carry at most ${MAX_VARS} environment variables.`,
  })
  .refine(
    (env) =>
      Object.values(env).every((v) => Buffer.byteLength(v, "utf8") <= MAX_VALUE_BYTES),
    { message: "One of those values is too large to be an environment variable." },
  )
  .refine(
    (env) =>
      Object.entries(env).reduce(
        (n, [k, v]) => n + Buffer.byteLength(k, "utf8") + Buffer.byteLength(v, "utf8"),
        0,
      ) <= MAX_TOTAL_BYTES,
    { message: "Those environment variables are too large in total." },
  );

/**
 * Enough to see that a value changed, useless for recovering it.
 *
 * Eight hex characters rather than a full digest: a complete SHA-256 of a short
 * or guessable secret is worth attacking, and a quarter of one is not.
 */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

/** Next.js compiles these into the browser bundle. */
export function isPublicName(key: string): boolean {
  return key.startsWith("NEXT_PUBLIC_");
}

/**
 * Record what this deploy changed, and forget the values.
 *
 * Merged, the same way the provider merges them: a name this deploy did not
 * mention keeps its row, because it keeps its value in production. Only a
 * name taken away on purpose disappears from the app page.
 */
export async function recordEnvChange(args: {
  appId: string;
  userId: string;
  change: EnvChange;
}): Promise<void> {
  const { appId, userId, change } = args;
  const database = db();

  const removed = change.unset.filter((key) => !(key in change.set));
  if (removed.length > 0) {
    await database
      .delete(appEnvVars)
      .where(and(eq(appEnvVars.appId, appId), inArray(appEnvVars.key, removed)));
  }

  for (const [key, value] of Object.entries(change.set)) {
    const row = {
      key,
      fingerprint: fingerprint(value),
      isPublic: isPublicName(key),
      setByUserId: userId,
      updatedAt: new Date(),
    };

    await database
      .insert(appEnvVars)
      .values({ id: newId("access"), appId, ...row })
      .onConflictDoUpdate({
        target: [appEnvVars.appId, appEnvVars.key],
        set: row,
      });
  }
}

export interface EnvVarSummary {
  key: string;
  fingerprint: string;
  isPublic: boolean;
  updatedAt: string;
}

/** What an app is configured with. Never a value - there is none to return. */
export async function listEnvVars(appId: string): Promise<EnvVarSummary[]> {
  const rows = await db()
    .select({
      key: appEnvVars.key,
      fingerprint: appEnvVars.fingerprint,
      isPublic: appEnvVars.isPublic,
      updatedAt: appEnvVars.updatedAt,
    })
    .from(appEnvVars)
    .where(inArray(appEnvVars.appId, [appId]));

  return rows
    .map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
