import type { BatchItem } from "drizzle-orm/batch";

/**
 * Several writes, or none of them.
 *
 * Cira reaches its database over HTTP, one request per query, and HTTP has no
 * way to say "these belong together" - so a sequence of writes could fail
 * partway and leave the half it had already done. That is not hypothetical
 * bookkeeping: replacing an app's capabilities deletes the old set before
 * writing the new one, and a failure in between leaves an app advertising a
 * fraction of what it can do, with every individual write having succeeded and
 * nothing to notice that anything went wrong.
 *
 * Neon answers this with a batch: a set of statements sent in one request and
 * executed inside one transaction. It is not interactive - every statement has
 * to be known before the first one runs - which rules out reading a result and
 * deciding what to write next. That suits Cira, because the decisions are
 * already made before any writing starts.
 */
type Statement = BatchItem<"pg"> & PromiseLike<unknown>;

/**
 * The statements are built from a handle rather than passed in, because a
 * drizzle statement is bound to whatever it was built from. Handing this a
 * ready-made list would mean those statements ran against the connection they
 * came from and quietly outside the transaction meant to contain them - which
 * would look exactly like working.
 */
export async function atomically<H extends object>(
  handle: H,
  build: (on: H) => readonly Statement[],
): Promise<void> {
  const batching = handle as {
    batch?: (statements: readonly [Statement, ...Statement[]]) => Promise<unknown>;
  };

  if (typeof batching.batch === "function") {
    const statements = build(handle);
    if (statements.length === 0) return;
    await batching.batch(statements as readonly [Statement, ...Statement[]]);
    return;
  }

  // An ordinary Postgres connection, which is what the integration tests use
  // because Neon's driver cannot reach a local database. It has no batch and
  // does not need one: it can hold a real transaction open, which is the same
  // guarantee by a different route. Worth supporting rather than skipping, so
  // that the tests exercise this code instead of walking around it.
  const transacting = handle as {
    transaction: (run: (tx: H) => Promise<void>) => Promise<void>;
  };

  await transacting.transaction(async (tx) => {
    for (const statement of build(tx)) await statement;
  });
}
