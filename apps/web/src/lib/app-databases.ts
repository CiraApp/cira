import "server-only";

import { eq } from "drizzle-orm";
import { appDatabases, db } from "@cira/db";
import { NeonDatabases, NeonError, neonConfigFromEnv } from "@cira/deploy";
import { ENV_NAME } from "@/lib/env-vars";

/**
 * An app's own Postgres database, made on Neon when its deploy asks for one.
 *
 * Made during the deploy rather than beside it, because a deploy is the only
 * thing that sets an app's variables: the address goes out with the rest of
 * them, to the web service, its workers, its scheduled runs and - the one that
 * matters on the first deploy - the release command that creates its tables.
 */

/** The row as the app page and the CLI need it. */
export interface AppDatabase {
  envName: string;
  region: string;
  createdAt: Date;
}

/** Whether this Cira can make databases at all. */
export function canMakeDatabases(): boolean {
  return neonConfigFromEnv() !== null;
}

function neon(): NeonDatabases | null {
  const config = neonConfigFromEnv();
  return config === null ? null : new NeonDatabases(config);
}

/** The name of the variable holding the direct address, beside the pooled one. */
export function directName(envName: string): string {
  return `${envName}_UNPOOLED`;
}

export async function appDatabase(appId: string): Promise<AppDatabase | null> {
  const [row] = await db()
    .select({
      envName: appDatabases.envName,
      region: appDatabases.region,
      createdAt: appDatabases.createdAt,
    })
    .from(appDatabases)
    .where(eq(appDatabases.appId, appId))
    .limit(1);
  return row ?? null;
}

export type DatabaseForDeploy =
  | {
      ok: true;
      /** Made by this deploy, so a deploy that goes no further takes it back out. */
      created: boolean;
      envName: string;
      /** The variables to set, pooled and direct. Handed on, never kept. */
      env: Record<string, string>;
    }
  | { ok: false; error: string };

/**
 * The app's database, made now if it has none, with the variables that point
 * at it. Asking again for an app that has one sets them again - which is also
 * how a variable someone unset by mistake comes back.
 */
export async function databaseForDeploy(args: {
  appId: string;
  spaceSlug: string;
  appSlug: string;
  userId: string;
  envName: string;
}): Promise<DatabaseForDeploy> {
  if (!ENV_NAME.test(args.envName)) {
    return { ok: false, error: "That is not a usable variable name for a database." };
  }
  const client = neon();
  if (client === null) {
    return {
      ok: false,
      error:
        "This Cira cannot make databases yet. Set the variable yourself to use one you have.",
    };
  }

  const database = db();
  const [existing] = await database
    .select()
    .from(appDatabases)
    .where(eq(appDatabases.appId, args.appId))
    .limit(1);

  try {
    if (existing !== undefined) {
      const urls = await client.urls({
        projectId: existing.externalId,
        databaseName: existing.databaseName,
        roleName: existing.roleName,
      });
      return {
        ok: true,
        created: false,
        envName: existing.envName,
        env: {
          [existing.envName]: urls.pooled,
          [directName(existing.envName)]: urls.direct,
        },
      };
    }

    const made = await client.create(`${args.spaceSlug}-${args.appSlug}`);
    await database.insert(appDatabases).values({
      appId: args.appId,
      provider: "neon",
      externalId: made.projectId,
      databaseName: made.databaseName,
      roleName: made.roleName,
      envName: args.envName,
      region: neonConfigFromEnv()!.region,
      createdByUserId: args.userId,
    });
    return {
      ok: true,
      created: true,
      envName: args.envName,
      env: {
        [args.envName]: made.urls.pooled,
        [directName(args.envName)]: made.urls.direct,
      },
    };
  } catch (error) {
    return { ok: false, error: databaseFailure(error) };
  }
}

/** The addresses, asked of Neon for someone who manages the app. */
export async function databaseUrls(
  appId: string,
): Promise<{ envName: string; pooled: string; direct: string } | null> {
  const client = neon();
  const [row] = await db()
    .select()
    .from(appDatabases)
    .where(eq(appDatabases.appId, appId))
    .limit(1);
  if (client === null || row === undefined) return null;
  const urls = await client.urls({
    projectId: row.externalId,
    databaseName: row.databaseName,
    roleName: row.roleName,
  });
  return { envName: row.envName, ...urls };
}

/**
 * Delete the app's database and everything in it. Before the app's row goes,
 * so a failure leaves the app - and the way to try again - where it was.
 */
export async function removeAppDatabase(
  appId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db()
    .select({ externalId: appDatabases.externalId })
    .from(appDatabases)
    .where(eq(appDatabases.appId, appId))
    .limit(1);
  if (row === undefined) return { ok: true };

  const client = neon();
  if (client === null) {
    return {
      ok: false,
      error: "This app has a database, and this Cira cannot reach Neon to delete it.",
    };
  }
  try {
    await client.remove(row.externalId);
  } catch (error) {
    return { ok: false, error: databaseFailure(error) };
  }
  await db().delete(appDatabases).where(eq(appDatabases.appId, appId));
  return { ok: true };
}

function databaseFailure(error: unknown): string {
  if (error instanceof NeonError && /limit/i.test(error.message)) {
    return "Cira has made as many databases as its Neon plan allows. Tell whoever runs Cira.";
  }
  return "Neon, where Cira makes databases, did not answer. Try again in a minute.";
}
