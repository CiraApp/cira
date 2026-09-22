import type { EnvVarSummary } from "@/lib/env-vars";

/**
 * What an app is configured with, and nothing more.
 *
 * Names, a fingerprint and who set them. There is no value to show and no
 * endpoint that would return one - Cira hands values to the provider and keeps
 * none, so this panel is the complete picture of what Cira knows. See
 * docs/secrets.md.
 *
 * The fingerprint earns its place by answering the question a list of names
 * cannot: whether the value behind a name is the one you set last week.
 */
export function EnvPanel({
  vars,
  database,
}: {
  vars: EnvVarSummary[];
  /** The variable a database Cira made is set as, when it made one. */
  database: { envName: string } | null;
}) {
  if (vars.length === 0) return null;
  const fromDatabase = new Set(
    database === null ? [] : [database.envName, `${database.envName}_UNPOOLED`],
  );

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-ink">Environment</h2>
        <p className="text-[11.5px] text-ink-subtle">
          Set by <code className="font-mono">cira deploy</code>. Values are never stored
          here.
        </p>
      </div>

      <ul className="mt-3 flex flex-col divide-y divide-line rounded-[var(--radius-edge)] border border-line bg-surface">
        {vars.map((entry) => (
          <li key={entry.key} className="flex items-center gap-3 px-4 py-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
              {entry.key}
            </code>

            {fromDatabase.has(entry.key) ? (
              <span
                title="The Postgres database Cira made for this app"
                className="shrink-0 rounded-[2px] border border-line-strong px-1.5 py-[1px] text-[10.5px] text-ink-muted"
              >
                database
              </span>
            ) : null}

            {entry.isPublic ? (
              <span
                title="Compiled into the browser bundle, so anyone who opens the app can read it"
                className="shrink-0 rounded-[2px] border border-pending/40 px-1.5 py-[1px] text-[10.5px] text-pending"
              >
                public
              </span>
            ) : null}

            <code
              title="First 8 hex of the value's SHA-256, so you can tell whether it changed"
              className="shrink-0 font-mono text-[11.5px] text-ink-subtle"
            >
              {entry.fingerprint}
            </code>
          </li>
        ))}
      </ul>

      {database === null ? null : (
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-subtle">
          <code className="font-mono">{database.envName}</code> is a Postgres database
          Cira made for this app on Neon, pooled for the app; the{" "}
          <code className="font-mono">_UNPOOLED</code> one is for migrations.{" "}
          <code className="font-mono">cira database url</code> prints its address for{" "}
          <code className="font-mono">psql</code> or{" "}
          <code className="font-mono">pg_dump</code>. Removing the app deletes it and
          everything in it.
        </p>
      )}
    </section>
  );
}
