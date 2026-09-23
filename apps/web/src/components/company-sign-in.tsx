"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  beginSso,
  completeSso,
  endSso,
  makeScimToken,
  stopScim,
} from "@/lib/sign-in-actions";
import type { SsoDetails } from "@/lib/sso";
import { CopyableCommand } from "./copyable-command";
import { LiveStatus } from "./ui/live-status";

/**
 * How a company's people get in, for its admins: through the company's own
 * identity provider, and kept in step with its directory.
 *
 * Each is a conversation with another system's admin screen, so each says
 * exactly what to copy across and where it came from, in the order that
 * screen will ask for it.
 */
export function CompanySignIn({
  spaceSlug,
  domain,
  sso,
  scim,
  scimBase,
}: {
  spaceSlug: string;
  /** The company's own domain, when the space has one. */
  domain: string | null;
  sso: SsoDetails | null;
  scim: { lastUsedAt: string | null; people: number } | null;
  /** The SCIM base URL identity providers are given. */
  scimBase: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [domainDraft, setDomainDraft] = useState(domain ?? "");
  const [metadata, setMetadata] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const [said, setSaid] = useState<string | null>(null);
  const ssoHeading = useRef<HTMLHeadingElement>(null);
  const scimHeading = useRef<HTMLHeadingElement>(null);
  const landing = useRef<HTMLHeadingElement | null>(null);

  const run = (
    work: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done: string,
    section: React.RefObject<HTMLHeadingElement | null>,
  ) => {
    if (pending) return;
    setError(null);
    setSaid(null);
    landing.current = section.current;
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.error);
      else {
        setSaid(done);
        router.refresh();
      }
    });
  };

  // Most of these replace the form they were pressed in - setting up draws
  // the details, stopping takes the button away - so focus would fall to the
  // top of the page. It goes to the heading of the part that changed instead.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && document.activeElement === document.body) {
      landing.current?.focus();
    }
    wasPending.current = pending;
  }, [pending]);

  return (
    <section className="mt-10">
      <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
        Company sign-in
      </h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
        People sign in with a code emailed to them. A company with Okta, Microsoft Entra
        or Google Workspace can send them through that instead, and keep who is here in
        step with its directory.
      </p>

      <div className="mt-4 overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
        <div className="px-4 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3
              ref={ssoHeading}
              tabIndex={-1}
              className="text-[13px] font-medium text-ink focus:outline-none"
            >
              Single sign-on (SAML)
            </h3>
            {sso !== null ? (
              <span
                className={`text-[11.5px] ${sso.active ? "text-live" : "text-pending"}`}
              >
                {sso.active ? `On for @${sso.domain}` : "Waiting for your provider"}
              </span>
            ) : null}
          </div>

          {sso === null ? (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  () => beginSso(spaceSlug, domainDraft),
                  "Single sign-on set up. Add these details to your provider.",
                  ssoHeading,
                );
              }}
            >
              <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-[12px] text-ink-subtle">
                Your company&rsquo;s email domain
                <input
                  value={domainDraft}
                  onChange={(event) => setDomainDraft(event.target.value)}
                  placeholder="acme.com"
                  spellCheck={false}
                  className="field py-2.5 font-mono text-[13px]"
                />
              </label>
              <button
                type="submit"
                disabled={domainDraft.trim() === ""}
                aria-disabled={pending || undefined}
                className="btn btn-secondary"
              >
                {pending ? "Setting up..." : "Set up"}
              </button>
            </form>
          ) : (
            <>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                {sso.active
                  ? `Anyone who signs in with an @${sso.domain} address is sent to your provider.`
                  : "In your provider, add a SAML app with these. Then paste the metadata URL it gives you."}
              </p>
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
                <Detail label="ACS URL" value={sso.acsUrl} />
                <Detail label="Entity ID" value={sso.spEntityId} />
                <Detail label="Metadata" value={sso.spMetadataUrl} />
                {sso.idpMetadataUrl !== null ? (
                  <Detail label="Your provider" value={sso.idpMetadataUrl} />
                ) : null}
              </dl>

              {!sso.active ? (
                <form
                  className="mt-3 flex flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(
                      () => completeSso(spaceSlug, metadata),
                      "Single sign-on is on",
                      ssoHeading,
                    );
                  }}
                >
                  <label className="flex min-w-[260px] flex-1 flex-col gap-1.5 text-[12px] text-ink-subtle">
                    Your provider&rsquo;s metadata URL
                    <input
                      value={metadata}
                      onChange={(event) => setMetadata(event.target.value)}
                      placeholder="https://acme.okta.com/app/.../sso/saml/metadata"
                      spellCheck={false}
                      className="field py-2.5 font-mono text-[12.5px]"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={metadata.trim() === ""}
                    aria-disabled={pending || undefined}
                    className="btn btn-primary"
                  >
                    {pending ? "Turning on..." : "Turn on"}
                  </button>
                </form>
              ) : null}

              <button
                type="button"
                aria-disabled={pending || undefined}
                onClick={() =>
                  run(() => endSso(spaceSlug), "Single sign-on stopped", ssoHeading)
                }
                className="btn btn-ghost mt-3 px-2 text-[12px] hover:text-failed"
              >
                Stop single sign-on
              </button>
            </>
          )}
        </div>

        <div className="border-t border-line px-4 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3
              ref={scimHeading}
              tabIndex={-1}
              className="text-[13px] font-medium text-ink focus:outline-none"
            >
              Directory sync (SCIM)
            </h3>
            {scim !== null ? (
              <span className="text-[11.5px] text-ink-subtle">
                {scim.lastUsedAt === null
                  ? "Not used yet"
                  : `${scim.people} ${scim.people === 1 ? "person" : "people"} kept in step`}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
            Your provider adds people as it assigns them, takes them out the moment they
            are deactivated, and keeps its groups as teams here, so access follows them.
          </p>
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
            <Detail label="Base URL" value={scimBase} />
          </dl>
          {token !== null ? (
            <div className="mt-3">
              <p id="scim-token-note" className="text-[11.5px] text-pending">
                Copy the token now. Cira keeps only a fingerprint and cannot show it
                again.
              </p>
              <div className="mt-1.5">
                <CopyableCommand command={token} shell={false} />
              </div>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              aria-disabled={pending || undefined}
              onClick={() =>
                run(
                  async () => {
                    const result = await makeScimToken(spaceSlug);
                    if (result.ok) setToken(result.data.token);
                    return result;
                  },
                  "Token made. Copy it now: Cira cannot show it again.",
                  scimHeading,
                )
              }
              className="btn btn-secondary"
            >
              {scim === null ? "Make a token" : "Make a new token"}
            </button>
            {scim !== null ? (
              <button
                type="button"
                aria-disabled={pending || undefined}
                onClick={() =>
                  run(
                    async () => {
                      setToken(null);
                      return stopScim(spaceSlug);
                    },
                    "Directory sync stopped",
                    scimHeading,
                  )
                }
                className="btn btn-ghost px-2 text-[12px] hover:text-failed"
              >
                Stop syncing
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <LiveStatus message={said} />

      {error !== null ? (
        <p role="alert" className="mt-2 text-[12.5px] text-failed">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="min-w-0 font-mono break-all text-ink select-all">{value ?? "-"}</dd>
    </>
  );
}
