import type { Metadata } from "next";
import { SiteFrame } from "@/components/site/site-frame";

export const metadata: Metadata = {
  title: "Subprocessors",
  description: "The companies Cira relies on, and what each one holds.",
};

/**
 * Who else touches a customer's data. Factual, and the page a company's
 * security review asks for first.
 */
const SUBPROCESSORS = [
  {
    name: "Google Cloud",
    role: "Runs every deployed app, builds them, stores their images and their logs.",
    data: "Your apps' code, their environment values, and whatever they log or store.",
    where: "United States (us-central1)",
  },
  {
    name: "Vercel",
    role: "Serves Cira itself.",
    data: "Requests to Cira, and its server logs.",
    where: "United States",
  },
  {
    name: "Neon",
    role: "Cira's database, and the databases Cira makes for apps that ask for one.",
    data: "Companies, people, apps, capabilities, and the records of what ran; and, in a separate project per app, whatever that app stores in its own database.",
    where: "United States (AWS us-east-1)",
  },
  {
    name: "Upstash",
    role: "The caches Cira makes for apps that ask for one.",
    data: "Whatever an app keeps in its own cache, in a separate database per app.",
    where: "United States (Google Cloud us-central1)",
  },
  {
    name: "Clerk",
    role: "Signs people in.",
    data: "Names, email addresses, and sessions.",
    where: "United States",
  },
  {
    name: "Cloudflare",
    role: "DNS, and the proxy every app is opened through.",
    data: "Requests to your apps in transit.",
    where: "Global edge",
  },
  {
    name: "Anthropic",
    role: "Reads a repository to describe what its app can do, and answers Ask Cira.",
    data: "Source files at deploy time, and the questions people ask with what the apps answered.",
    where: "United States",
  },
  {
    name: "Stripe",
    role: "Takes payment.",
    data: "Billing contact and payment details, which Cira itself never sees.",
    where: "United States",
  },
  {
    name: "Resend",
    role: "Sends Cira's email.",
    data: "Email addresses, and the contents of invitations and notifications.",
    where: "United States",
  },
  {
    name: "Sentry",
    role: "Collects Cira's own errors.",
    data: "Error reports from Cira, with request bodies, cookies and headers removed.",
    where: "United States",
  },
];

export default function SubprocessorsPage() {
  return (
    <SiteFrame wide>
      <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink">
        Subprocessors
      </h1>
      <p className="mt-3 max-w-[620px] text-[14px] leading-relaxed text-ink-muted">
        Cira is built on other people&rsquo;s infrastructure, and you should know whose
        before you put your company&rsquo;s software on it. This list changes when what
        Cira runs on changes.
      </p>

      <ul className="mt-8 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
        {SUBPROCESSORS.map((one) => (
          <li key={one.name} className="px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <p className="text-[13.5px] font-medium text-ink">{one.name}</p>
              <p className="text-[12px] text-ink-subtle">{one.where}</p>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{one.role}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-subtle">
              {one.data}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-6 max-w-[620px] text-[12.5px] leading-relaxed text-ink-subtle">
        Cira does not store the values of your apps&rsquo; environment variables: they
        pass through on their way to Google and are kept by Google, the same as they would
        be if you deployed there yourself.
      </p>
    </SiteFrame>
  );
}
