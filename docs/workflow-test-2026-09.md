# Workflow test, September 2026

Two mock companies run on production, by five people, through the work a
design partner's first weeks would hold. Done 2026-09-23, to find what a
customer would otherwise find first. Everything below was done in the product
as a person would - the browser, the CLI, an assistant over MCP - and each fix
was checked again on production after it shipped.

## The companies

**Northwind Freight**, a logistics company. Founded by its owner, with Maya
(admin), Theo (member, Engineering), Rosa (member, Operations, no name set on
her account) and Leo (member, on no team, later removed and invited back).

- **Dispatch API** - Node and Postgres, deployed by Theo as a plain member,
  with reads and writes for agents; shared with Operations.
- **Fleet board** - a Vite static site with a public `VITE_` variable.
- **Rate quoter** - a Dockerfile service with a Redis cache, deployed by Maya,
  that answers every address alike.
- **Nightly manifest** - Python, with a scheduled run from a GitHub Actions
  workflow.
- **Intake form** - a Node app that crashes as it starts.

**Bluepeak Clinic**, founded by Maya from inside Northwind, with Rosa invited
in: one person in two companies. One app, Clinic Rota. Deleted at the end.

A stranger in no company tried both companies' apps from the CLI.

## What was run

- Founding a company, and a second one from inside the first.
- Teams, and invitations by email with a role and teams, to people with and
  without a name on their account. Accepting while signed out, joining,
  reopening an accepted link.
- CLI login from a second person's machine, approved in their browser.
- Deploys of each kind above, the choice of company for someone in two, and a
  deploy that fails as it starts.
- Access: an app nobody has shared, sharing with a team, what a member sees and
  cannot see, and the app's own address opened directly.
- Ask: a read, and a write that stops for the person's go-ahead. Ask in the
  second company, which must not reach the first's apps.
- An assistant over MCP: search across both companies, a read, a write turned
  off, and a write through an approval, including reusing it for other input.
- Capabilities the app could not confirm, turned on by a person and confirmed
  by their first call.
- A redeploy that adds a route and a variable, a rollback, and a roll forward.
- Scheduled runs: run now, a second press while one is going, its logs.
- Roles, removing someone and inviting them back, their access afterwards.
- Removing an app from the CLI, the change record, and deleting a company.
- A page left open across a Cira deploy.

## What it found

Twenty-two things, all fixed the same day: E2E-14 to E2E-35 in
docs/hardening.md, and CAP-23 for capabilities that could never be confirmed.
The four that would have hurt a design partner most:

- A deploy that crashed as it started showed the build log and blamed the
  port; the error that named the problem was never shown (E2E-14).
- Any page left open across a Cira deploy broke on its next button press
  (E2E-16).
- Routes added after an app's first deploy never became capabilities
  (E2E-17), and some routes could never be confirmed or turned on at all
  (CAP-23).
- There was no not-found page (E2E-15).

## What held

- Company lines: a stranger's CLI could not remove, deploy to or read the
  database of another company's app; Ask in one company never reached the
  other's apps; MCP labels every result with its company.
- Access: an app shared with nobody is invisible to members at its page, its
  own address and its API; sharing with a team reaches exactly that team.
- Writes: nothing an agent or Ask changes runs without the person's go-ahead;
  an approval covers exactly the input shown, once.
- Removal: someone removed loses every app at once, and comes back only by a
  new invitation.
- Variables a deploy does not send stay as they are, through a rollback and a
  roll forward.

## Not covered

What needs a real company's setup: single sign-on and directory sync against a
real identity provider, a custom domain's DNS, and paying through Stripe.
Browser runs were cut short by memory on the test machine, which was shared
with other work; nothing in Cira was behind the crashes, and each step that
was interrupted was run again.
