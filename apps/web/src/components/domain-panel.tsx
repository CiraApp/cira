"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addAppDomain, checkAppDomains, removeAppDomain } from "@/lib/domain-actions";

interface Domain {
  hostname: string;
  state: "pending" | "active" | "failed";
  reason: string | null;
}

/**
 * The app on a name of the company's own.
 *
 * Adding the name is half of it; the other half happens in the company's DNS,
 * which Cira cannot see into or do for them. So a name that is waiting says
 * exactly what record to make and where, and keeps saying it until the
 * certificate is issued - a name that silently sits at "pending" is the most
 * common way this goes wrong everywhere else.
 */
export function DomainPanel({
  spaceSlug,
  appSlug,
  appAddress,
  target,
  domains,
  limit,
}: {
  spaceSlug: string;
  appSlug: string;
  /** Its Cira address, which keeps working either way. */
  appAddress: string;
  /** What a CNAME points at, or null when this Cira cannot add names. */
  target: string | null;
  domains: Domain[];
  limit: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  };

  if (target === null && domains.length === 0) return null;
  const waiting = domains.some((domain) => domain.state !== "active");

  return (
    <section className="enter-up mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
          Your own domain
        </h2>
        <p className="text-[12px] text-ink-subtle">
          It keeps answering at <span className="font-mono">{appAddress}</span> too
        </p>
      </div>

      {domains.length > 0 ? (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
          {domains.map((domain) => (
            <li key={domain.hostname} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span
                  aria-hidden="true"
                  className={`h-[6px] w-[6px] shrink-0 rounded-full ${
                    domain.state === "active"
                      ? "bg-live"
                      : domain.state === "failed"
                        ? "bg-failed"
                        : "bg-pending"
                  }`}
                />
                {domain.state === "active" ? (
                  <a
                    href={`https://${domain.hostname}`}
                    className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink underline-offset-4 hover:underline"
                  >
                    {domain.hostname}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                    {domain.hostname}
                  </span>
                )}
                <span
                  className={`text-[11.5px] ${
                    domain.state === "active"
                      ? "text-live"
                      : domain.state === "failed"
                        ? "text-failed"
                        : "text-pending"
                  }`}
                >
                  {domain.state === "active"
                    ? "Live"
                    : domain.state === "failed"
                      ? "Could not be set up"
                      : "Waiting for DNS"}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() => removeAppDomain(spaceSlug, appSlug, domain.hostname))
                  }
                  className="btn btn-ghost px-2 py-1 text-[12px]"
                >
                  Remove
                </button>
              </div>

              {domain.state !== "active" && target !== null ? (
                <div className="mt-2.5 rounded-[var(--radius-edge)] border border-line bg-sunken/50 px-3.5 py-3 text-[12px] leading-relaxed text-ink-muted">
                  <p>
                    In the DNS for{" "}
                    <span className="font-mono text-ink">
                      {parentOf(domain.hostname)}
                    </span>
                    , add this record. Cira gets it a certificate once it is there,
                    usually within minutes.
                  </p>
                  <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-[12px]">
                    <dt className="text-ink-subtle">Type</dt>
                    <dd className="text-ink">CNAME</dd>
                    <dt className="text-ink-subtle">Name</dt>
                    <dd className="break-all text-ink">{domain.hostname}</dd>
                    <dt className="text-ink-subtle">Target</dt>
                    <dd className="break-all text-ink">{target}</dd>
                  </dl>
                  {domain.reason !== null ? (
                    <p className="mt-2 text-[11.5px] text-ink-subtle">
                      Cloudflare says: {domain.reason}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {target !== null && domains.length < limit ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const hostname = value;
            run(async () => {
              const result = await addAppDomain(spaceSlug, appSlug, hostname);
              if (result.ok) setValue("");
              return result;
            });
          }}
        >
          <label htmlFor="app-domain" className="sr-only">
            A domain for this app
          </label>
          <input
            id="app-domain"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="tools.yourcompany.com"
            autoComplete="off"
            spellCheck={false}
            className="field min-w-0 flex-1 font-mono text-[12.5px] sm:max-w-[320px]"
          />
          <button
            type="submit"
            disabled={pending || value.trim() === ""}
            className="btn btn-secondary"
          >
            {pending ? "Adding..." : "Add domain"}
          </button>
          {waiting ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => checkAppDomains(spaceSlug, appSlug))}
              className="btn btn-ghost text-[12.5px]"
            >
              Check again
            </button>
          ) : null}
        </form>
      ) : waiting ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => checkAppDomains(spaceSlug, appSlug))}
          className="btn btn-ghost mt-3 text-[12.5px]"
        >
          Check again
        </button>
      ) : null}

      {error !== null ? (
        <p role="alert" className="mt-2 text-[12.5px] text-failed">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Where the record goes: the name without its first label. */
function parentOf(hostname: string): string {
  return hostname.split(".").slice(1).join(".");
}
