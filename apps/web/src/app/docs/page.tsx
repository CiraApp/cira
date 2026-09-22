import Link from "next/link";
import type { Metadata } from "next";
import { SiteFrame, Section } from "@/components/site/site-frame";
import { CopyableCommand } from "@/components/copyable-command";

export const metadata: Metadata = {
  title: "Docs",
  description: "Deploying to Cira, opening apps, and using them from an assistant.",
};

/**
 * The public docs: enough to deploy something and to point an assistant at
 * it, written for somebody who has not signed up yet. Everything deeper is on
 * the page it belongs to, inside the product, where it can say what is
 * actually true of that app.
 */
export default function DocsPage() {
  return (
    <SiteFrame>
      <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink">
        Docs
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">
        Cira takes a repository as it is. There is nothing to add to it - no manifest, no
        Dockerfile you did not already want, no pipeline.
      </p>

      <Section title="Deploy an app">
        <p>Install the CLI and sign in from the machine you already build on:</p>
        <CopyableCommand command="npm install -g @cira-app/cli" />
        <CopyableCommand command="cira login" />
        <p>
          Then, in the repository, deploy it. Cira works out the framework, the parts to
          build, the variables it needs and the workers or scheduled runs it declares, and
          asks you before it does anything you did not expect.
        </p>
        <CopyableCommand command="cira deploy" />
        <p>
          A repository with a <code>Procfile</code>, a <code>fly.toml</code> or a
          scheduled GitHub Actions workflow keeps those: its workers and its timetables
          come across, switched off until somebody turns them on.
        </p>
      </Section>

      <Section title="Give it a database">
        <p>
          An app that reads <code>DATABASE_URL</code> and has none is offered one when it
          deploys: its own Postgres, made on Neon for that app alone. Or ask for one
          outright, which is how a script says yes:
        </p>
        <CopyableCommand command="cira deploy --database" />
        <p>
          The app gets <code>DATABASE_URL</code>, through Neon&rsquo;s pooler, and{" "}
          <code>DATABASE_URL_UNPOOLED</code> for migrations - and so do its workers, its
          scheduled runs and its release command, so a first deploy can create its tables.
          To look inside, or to take the data with you:
        </p>
        <CopyableCommand command={`psql "$(cira database url)"`} />
        <p>
          Removing the app deletes its database and everything in it. An app that already
          has a database of its own keeps it; Cira never replaces one.
        </p>
      </Section>

      <Section title="Open it">
        <p>
          Every app is at <code>{`{app}--{space}.cira.dev`}</code>, and everyone who is
          allowed to open it signs in to Cira once. The app never has to know about any of
          that - it is reached through Cira&rsquo;s own door, and only by people the
          app&rsquo;s managers named.
        </p>
      </Section>

      <Section title="Use it from an assistant">
        <p>
          Cira reads each app for the operations it offers and turns them into tools an
          assistant can use. Point Claude Code or Cursor at Cira once:
        </p>
        <CopyableCommand command="cira mcp connect" />
        <p>
          The assistant then gets four tools, whatever the company has deployed: search
          the company&rsquo;s capabilities, read one, run one, and check how an app is
          doing. Everything it runs, it runs as the person asking, with their permissions
          and nobody else&rsquo;s. Anything that changes data waits for a person to agree.
        </p>
        <p>
          Inside Cira, the same thing is a box on the page: ask a question in plain words
          and Cira uses the company&rsquo;s own software to answer it.
        </p>
      </Section>

      <Section title="If your app signs its own users in">
        <p>
          Most internal software has its own login, and a call that says only &ldquo;Cira
          is calling&rdquo; is no use to it. Turn on <em>Tell this app who is calling</em>{" "}
          in the app&rsquo;s settings and Cira sends a signed statement naming the person
          behind each request:
        </p>
        <pre className="overflow-x-auto rounded-[var(--radius-edge)] border border-line bg-sunken/60 p-4 font-mono text-[12px] leading-relaxed text-ink-muted">
          {`# Python, with any JWT library
claims = jwt.decode(
    request.headers["x-cira-identity"],
    key=cira_keys(),                    # https://cira.dev/.well-known/cira-jwks.json
    algorithms=["ES256"],
    audience="https://your-app.example",  # your own address
    issuer="https://cira.dev",
)
user = find_user_by_email(claims["email"])`}
        </pre>
        <p>
          It carries who they are - id, name, verified email - which company, and whether
          a person or their assistant is asking (<code>via</code>). It carries nothing
          anyone could be signed in with, it names your app as its audience, and it lasts
          sixty seconds. Verify it; never trust the header unchecked, because anyone who
          can reach your app can set a header.
        </p>
      </Section>

      <Section title="Keep an eye on it">
        <p>
          Each app has its runtime logs, its recent runs, and a record of who ran what.
          Cira watches every app by itself and emails whoever manages it when a deploy
          fails, an app stops answering, a worker keeps stopping or a scheduled run fails.
        </p>
      </Section>

      <p className="mt-10 text-[13px] text-ink-muted">
        The rest is on each app&rsquo;s own page.{" "}
        <Link href="/pricing" className="underline underline-offset-4">
          Pricing
        </Link>{" "}
        is per person, with the always-on parts billed separately.
      </p>
    </SiteFrame>
  );
}
