import Link from "next/link";
import type { Metadata } from "next";
import { SiteFrame, Section } from "@/components/site/site-frame";

export const metadata: Metadata = {
  title: "Security · Cira",
  description: "How Cira handles access, secrets and the software it runs.",
};

/**
 * How Cira actually works, where that is a security question. Written to be
 * true rather than reassuring: everything here is something the code does,
 * and the gaps are named as gaps.
 */
export default function SecurityPage() {
  return (
    <SiteFrame>
      <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink">
        Security
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">
        What follows is how Cira is built today, including the parts that are not
        finished. If something matters to you and is not here, ask.
      </p>

      <Section title="Who can open what">
        <p>
          An app is visible to the people its managers named: one person, a team, or
          everyone in the company. That rule is checked where the data is read, not in a
          list of paths, so a page cannot ship unprotected by being forgotten.
        </p>
        <p>
          Apps are reached through Cira&rsquo;s own proxy. A request without a valid
          session never reaches your app at all.
        </p>
      </Section>

      <Section title="Secrets">
        <p>
          Cira is a conduit, not a vault. The values of your environment variables pass
          through on their way to Google and are never written to Cira&rsquo;s database or
          its logs; Cira keeps their names and a fingerprint so a page can say what is
          set. Credentials Cira issues - CLI tokens, invitations, device codes - are
          stored only as hashes.
        </p>
        <p>
          Cira reaches Google with short-lived tokens from workload identity federation.
          There is no downloadable service-account key.
        </p>
      </Section>

      <Section title="What agents can do">
        <p>
          An assistant acts as the person using it and gets exactly their permissions.
          Anything that changes data stops and waits for that person to agree. Every run
          is recorded - who, what, from where, and how it ended - and never what it was
          called with or what came back.
        </p>
      </Section>

      <Section title="What Cira knows about your apps">
        <p>
          Metadata: names, addresses, which operations exist, deploy history, and what
          ran. Not your apps&rsquo; own data. Ask Cira&rsquo;s conversations live in the
          browser tab that holds them, and only what a question cost is kept.
        </p>
        <p>
          Cira&rsquo;s own error reports are stripped of request bodies, cookies, queries
          and headers before they leave.
        </p>
      </Section>

      <Section title="Not done yet">
        <p>
          Every company&rsquo;s apps run in one Google project, isolated by Cloud
          Run&rsquo;s own boundaries rather than by separate projects. SAML and SCIM are
          not built. Cira has not been through a SOC 2 audit or an external penetration
          test. All three are planned, and none of them is true today.
        </p>
      </Section>

      <p className="mt-10 text-[13px] text-ink-muted">
        Reporting something:{" "}
        <a href="mailto:security@cira.dev" className="underline underline-offset-4">
          security@cira.dev
        </a>
        . See also{" "}
        <Link href="/legal/subprocessors" className="underline underline-offset-4">
          subprocessors
        </Link>
        .
      </p>
    </SiteFrame>
  );
}
