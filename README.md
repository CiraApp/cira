# Cira

**Cira is where a company's internal software lives.** A developer runs
`cira deploy` in a repository, and the app is built, hosted and put in front of
the right colleagues: no cloud console, no manifest, no infrastructure to own.
Employees open Cira and see the apps they are allowed to use. AI agents connect
to Cira over MCP and can find and call what those apps do.

```text
Developer   cira deploy   ──▶   running app, access-controlled, on its own address
Employee    cira.dev      ──▶   the company's apps, one place, one sign-in
Agent       MCP           ──▶   search, describe and invoke what those apps can do
```

The product specification is [`docs/spec.md`](docs/spec.md). How secrets are
handled is [`docs/secrets.md`](docs/secrets.md). The reasoning behind past
decisions is recorded in [`CHECKLIST.md`](CHECKLIST.md).

**Contents**

- [Concepts](#concepts)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [How it works](#how-it-works)
  1. [Joining a company](#1-joining-a-company)
  2. [Connecting a machine](#2-connecting-a-machine)
  3. [Deploying an app](#3-deploying-an-app)
  4. [Opening an app](#4-opening-an-app)
  5. [Capabilities](#5-capabilities)
  6. [Agents over MCP](#6-agents-over-mcp)
  7. [Access control](#7-access-control)
  8. [Reaching Google without keys](#8-reaching-google-without-keys)
- [Design principles](#design-principles)
- [Known limits](#known-limits)
- [Development](#development)
- [Shipping](#shipping)
- [The CLI](#the-cli)

## Concepts

```text
User ──▶ Space ──▶ App ──▶ Services
                    │
                    ├──▶ Deployments
                    └──▶ Capabilities
```

| Concept        | What it is                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Space**      | Usually a company. Everything belongs to one. People join by invite, or automatically if their verified email is on the company's domain.                                    |
| **Membership** | A person's place in a space, with a role: `member`, `admin` or `owner`. Members can also belong to **teams**.                                                                |
| **App**        | One piece of internal software, with a name, a picture, an address and access rules. Any member can deploy one.                                                              |
| **Service**    | A deployable part of an app. Most apps have one; a frontend with its API behind it has two, deployed together as one app.                                                    |
| **Deployment** | One attempt to put a version of an app into service: `queued`, `building`, `deploying`, `live`, `failed` or `removed`.                                                       |
| **Access**     | Who may open an app: named people, whole teams, or the whole space.                                                                                                          |
| **Capability** | One business operation an app already performs - "get revenue between two dates" - described well enough that an agent can find it and call it. Cira works these out itself. |

## Architecture

```text
                        ┌────────────────────────────────────────────┐
  cira CLI ──── API ───▶│                                            │───▶ Neon Postgres
                        │  Cira web app                              │     metadata only
  Browser ── cira.dev ─▶│  Next.js on Vercel                         │
                        │                                            │───▶ Clerk
  AI agent ──── MCP ───▶│  gallery · app pages · CLI API · MCP       │     who someone is
                        │                                            │
                        └──────┬──────────────────────────┬──────────┘───▶ Claude
                               │ Google APIs              │ identity         capability
                               │ (no stored keys)         │ tokens           analysis
                               ▼                          ▼
  CLI ── source ──▶  Cloud Storage ──▶ Cloud Build ──▶ Artifact Registry ──▶ Cloud Run
                                                                              ▲
  Browser ── {app}--{space}.cira.dev ──▶ Cloudflare Worker (app proxy) ──────┘
```

| Component         | Runs on            | Job                                                                                          |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| **Cira web app**  | Vercel             | The product: gallery, app pages, settings, the API the CLI calls, and the MCP endpoint.      |
| **Neon Postgres** | Neon               | Cira's own records: spaces, people, apps, deployments, capabilities. Never an app's data.    |
| **Clerk**         | Clerk              | Answers "who is this person" and nothing else. Only `lib/identity.ts` imports it.            |
| **`cira` CLI**    | The developer      | Works out what a repository is, gathers its environment, uploads it, and follows the deploy. |
| **Google Cloud**  | Google             | Cloud Build turns source into images; Cloud Run runs them, privately.                        |
| **App proxy**     | Cloudflare Workers | Stands between a browser and a private Cloud Run service, on a hostname per app.             |
| **Claude**        | Anthropic          | Reads an app's source once per deploy and proposes its capabilities.                         |

Cira does not own compute. Everything that touches the cloud goes through the
`DeploymentProvider` interface in `packages/core`, and Cloud Run is the one
implementation of it. Nothing above that interface knows which provider is in
use.

## Repository layout

```text
apps/
  web/            Next.js app: product UI, CLI API, MCP endpoint, capability engine
packages/
  core/           Domain model, permission rules, capability rules. No framework, no I/O.
  db/             Drizzle schema, SQL migrations, the `atomically` helper, demo seed
  deploy/         Cloud Run provider, source bundling, the environment scanner, source packing
  cli/            The `cira` command, published as @cira-app/cli
  cira-skill/     SKILL.md - what coding agents are taught about Cira
workers/
  app-proxy/      The Cloudflare Worker in front of every deployed app
fixtures/
  capability-analyzer/   A reference app with known capabilities, for measuring the analyzer
docs/
  spec.md         Product specification
  secrets.md      How environment variables are handled
```

`packages/core` holds rules as pure functions that take explicit records. Every
check runs on the server; ids a client sends are never trusted.

## How it works

### 1. Joining a company

A person signs in through Clerk. On first sign-in, onboarding either creates a
space for their company or joins one. A space founded with a company email
records that domain, and anyone who later signs in with a verified address on
it joins automatically as a member. Everyone else arrives through an invite
link. Admins and owners manage members, teams and roles from the space's
members page.

### 2. Connecting a machine

`cira login` uses a device flow, so no password or secret is ever typed into a
terminal:

```text
cira login ──▶ POST /api/cli/auth/start      gets a device code and a short user code
           ──▶ opens cira.dev/cli            the person, already signed in, approves the code
           ──▶ POST /api/cli/auth/poll       returns a token once approved
```

The token is stored in `~/.cira/config.json`. It is the one credential the CLI
uses for everything, and the same one an agent uses over MCP - so revoking it
cuts off both.

### 3. Deploying an app

`cira deploy` is the whole developer experience. Nothing needs writing first.

```text
 CLI                                      Cira                          Google
 ───                                      ────                          ──────
 who am I, which space      ──────────▶   /api/cli/me
 walk files, find services
 check the environment
 ask for an upload URL      ──────────▶   /api/cli/source
 upload source archive      ─────────────────────────────────────────▶  Cloud Storage
 start the deploy           ──────────▶   /api/cli/deploy  ──────────▶  Cloud Build + Cloud Run
 start capability analysis  ──────────▶   /api/cli/capabilities ────▶   Claude
 poll every 3 seconds       ──────────▶   /api/cli/deploy/status ───▶   build done? swap image
 once live: verify          ──────────▶   /api/cli/capabilities/verify ─▶ the running app
 print the address and what the app can do
```

**What the CLI works out.** Which space to deploy into: an explicit
`--space`, then the folder's existing link, then the only space the person is
in. Which **services** the repository contains: a frontend and its API are
recognised from each half's own toolchain files, with no configuration, and
the browser-facing half (Next.js before a bare Node server) is chosen to take
the public port. Whether each service has a **Dockerfile**: if so it is built
with it, otherwise Cloud Build's buildpacks detect the language.

**The environment.** The CLI reads the first of `.env.production.local`,
`.env.local`, `.env.production` or `.env` that exists, and scans the source
for variables the code reads with no default, or with a default pointing at
`localhost`. It prints one checklist, marking each variable ✓ or ✗:

```text
Environment (from .env.local)
  ✓ DATABASE_URL
  ✓ S3_ACCESS_KEY
  ✗ REDIS_URL      defaults to localhost, in apps/api/app/config.py
```

For anything missing, it asks for the value in the terminal (masked), and
going without one means typing `skip` - pressing Enter does not. It also
lists every `NEXT_PUBLIC_` variable separately, because those are compiled into
the JavaScript a browser downloads and are readable by anyone who opens the app.

Values are never stored by Cira. They travel with the deploy request, are
written straight onto the Cloud Run service, and are forgotten. Cira keeps
each variable's name, an 8-character fingerprint and who set it, so the app
page can show what is configured and when it changed. The full design is in
[`docs/secrets.md`](docs/secrets.md).

**The upload.** The source is packed into one archive, without local `.env`
files (`.env.example` is kept), `node_modules` or `.git`, and sent straight from the CLI to Cloud Storage with
a signed URL that allows writing one object once. It never passes through Cira,
which is what lets a real project deploy at all: Vercel caps request bodies far
below the size of one.

**The build and the rollout.** `POST /api/cli/deploy` checks membership,
creates or finds the app, records its services and starts one Cloud Build with
a step per service. Each service becomes a container in a single Cloud Run
service:

```text
  one Cloud Run service
    web   ingress    takes the public port        e.g. Next.js
    api   sidecar    listens on localhost:8000    e.g. FastAPI
```

The containers share a network, so a frontend that already proxies to
`localhost:8000` in development finds its API in the same place in production,
unchanged. Each sidecar gets a TCP startup probe, and the ingress container
waits for them to be ready. A single-container app runs with 512 MiB and CPU
that idles between requests; a multi-container app gets 1 CPU and 1 GiB that
stays allocated, because a sidecar's background work would otherwise be starved.

A redeploy never takes an app down for the length of its build. The
environment is written to the service immediately, but it keeps serving the
image it already has. Only when the build succeeds does a status poll swap in
the new images, which starts a new revision. The deployment is `live` once
that revision is ready.

**Addresses.** An app is served at `{app}--{space}.cira.dev`. Renaming an app
moves its address, and the old one keeps forwarding to it. An address another
app used to answer on stays reserved, so no saved link ever lands in a
different app.

**After it is live.** Cira asks the running app whether its root serves a page.
If it does, the app gets an **Open** button; if it is an API, it does not, and
an app whose frontend lives elsewhere can be given a homepage address instead.

### 4. Opening an app

Cloud Run services are private: every request needs a Google identity token
addressed to that service, and a browser cannot add a header to a navigation.
So each app gets its own hostname, and a Cloudflare Worker in front of all of
them adds the token.

```text
 1. Open   ──▶  cira.dev/enter/{app}--{space}      Cira checks this person may open the app
 2.        ◀──  redirect with a signed session     HMAC, 15 minutes, for this app only
 3.        ──▶  {app}--{space}.cira.dev            Worker checks the signature and sets a
                                                   host-only __Host- cookie
 4.             Worker ──▶ cira.dev/api/proxy/token   gets a Google identity token for the
                                                   app (cached per isolate for an hour)
 5.             Worker ──▶ {service}.run.app       forwards the request with the token
```

The worker decides nothing. Cira decides who may open what and signs that
decision; the worker only verifies a signature and forwards. Signing rather
than asking saves a round trip to Cira for every image on a page. The cost is
that revoking someone's access takes effect when their session expires, at
most 15 minutes later (`SESSION_SECONDS` in `packages/core/src/proxy-session.ts`).

A hostname per app rather than a path per app matters for two reasons: apps
request their assets at absolute paths like `/_next/static/x.js`, which would
collide under a shared host; and separate origins stop one app's scripts
reading another's storage. The `--` separator can never appear inside a slug,
so `acme-corp` + `ledger` and `acme` + `corp-ledger` cannot collide, and one
DNS label is exactly what a free wildcard certificate covers.

### 5. Capabilities

Deploying an app also publishes what it can do. Nobody writes a manifest.

```text
 source ──▶ analysis ──▶ checks ──▶ registry ──▶ verification ──▶ published
            (Claude)     (rules)    (Postgres)    (the running app)   to agents
```

**Analysis.** While the build runs, Cira reads the uploaded archive, packs its
source into one document (lockfiles, generated code and binaries are left out,
tests go last, and the whole is capped at 500 KB so it fits the model's
context), and makes one streamed model call. The model proposes operations an
employee would recognise, each with a name, a description, an HTTP method, a
root-relative path, an input schema and an example input. It is language-
agnostic: nothing about it knows what framework an app uses. The default model
is Claude Haiku 4.5; `CIRA_ANALYZER_MODEL` overrides it.

**Checks.** `capability-grounding.ts` decides what Cira is willing to store.
It needs no model: names must be well-formed, paths must be root-relative and
unable to leave the app's own host, and schemas must be valid. Anything else
is dropped.

**Registry.** Capabilities are stored against their app. A redeploy replaces
the set, but a decision a person made survives it: re-detecting a write
someone turned off does not turn it back on.

**Verification.** Reading code can be wrong, so nothing is offered to an agent
until the running app confirms it. First a control request to a random path
must return 404, otherwise the app answers everything and nothing can be
confirmed. Then:

- a **read** is actually called, with its example input;
- a **write** is never called. Its path is asked which methods it allows.

What the app says is recorded as the capability's `reach`:

| App's answer                  | `reach`    | What happens                                                             |
| ----------------------------- | ---------- | ------------------------------------------------------------------------ |
| 404                           | -          | Deleted. Nothing serves it; the analysis was wrong.                      |
| 401 or 403                    | `refused`  | Kept and explained. The route is real, but the app will not let Cira in. |
| anything else, even 4xx / 5xx | `callable` | The app's own code ran, so Cira can reach it.                            |
| no answer                     | `pending`  | Left alone and asked again later.                                        |

A refusal belongs to the build that gave it. Once a different deployment is
live, it reads as `pending` again, so a developer who lets Cira in and
redeploys is heard. For a write, a method probe cannot tell an open route from
a guarded one, because frameworks reject a wrong method before they check who
is asking. So a write only counts as `refused` when a real call is turned
away (see below).

Verification runs after `cira deploy`, and again whenever someone opens an
app's page while anything is still unconfirmed.

**Publication.** A capability is offered to agents when it is both
**enabled** and **callable**. Reads enable themselves; writes are registered
off and wait for someone who can manage the app to turn them on.

### 6. Agents over MCP

`cira mcp connect` points Claude Code and Cursor on the machine at
`https://cira.dev/api/mcp`, using the `cira login` token. The endpoint is
stateless Streamable HTTP and exposes four fixed tools, whatever the company
has deployed. Ask Cira drives the same four, as the person asking:

| Tool                  | Does                                                                             |
| --------------------- | -------------------------------------------------------------------------------- |
| `search_capabilities` | Finds capabilities across every app this person can open. Empty query lists all. |
| `describe_capability` | Returns one capability's full description and input schema.                      |
| `invoke_capability`   | Runs it and returns the app's JSON.                                              |
| `app_status`          | Says whether an app is live and how its workers and scheduled runs are doing.    |

Fixed tools rather than one per capability, so a company's shelf can change
with every deploy without an agent re-reading a tool list.

An invocation passes, in order: the person's access to the app, the capability
being enabled and callable, and its input against the schema. Only then is a
URL built, from the app's own deployment plus the capability's path, so a
capability can never address anything but the app it came from. The call
carries an identity token for that one app and nothing that identifies a
person. A capability that cannot be run says why - "not enabled" means ask an
admin, "the app signs its own users in" means no setting in Cira will help.

A write that answers 401 to a real call is recorded as `refused`, so the next
agent is told before it tries. That only happens while calls identify nobody:
the headers are checked against an allow-list, so any future change that
passes a person's identity turns the recording off by itself.

The same capabilities can be run by hand from an app's **console**
(`/{space}/{app}/console`), for the person who knows which call they want and
would rather not have a model in between. Each capability becomes a form
generated from its input schema (`packages/core/src/capability-console.ts`),
prefilled for a read from the example input it was verified with. Writes show
exactly what they will send and wait for a confirmation. An app with no web
page opens into its console, so an API-only app is usable by anyone who may
open it. The console posts to one server action, `lib/console-actions.ts`,
which resolves the person from the session and calls the same
`invokeCapability` an agent's `invoke_capability` does. Runs are kept in the
page's memory and nowhere else.

Every run, from MCP, Ask Cira or the console, is written to `invocations`:
who, which capability, from where, and how it ended - the app's status, or the
check that stopped it - and never the input or the reply. Whoever manages an
app sees them on its page under Capability runs. The same record is what limits a person
to 60 runs a minute; a run refused by that limit is not written.

### 7. Access control

One rule decides who may open an app, and everything else follows from it:

1. You must be a member of the app's space. Membership alone grants nothing.
2. The app's owner can always open it.
3. Admins and owners of the space can open every app in it.
4. Otherwise, an access rule must name you, one of your teams, or the space.

Capabilities have no permissions of their own: you may discover and call a
capability exactly when you may open its app. Managing an app - settings,
access, environment, deletion, turning capabilities on - is for its owner and
the space's admins. The rules live in `packages/core/src/permissions.ts` as
pure functions and are tested there.

### 8. Reaching Google without keys

Cira holds no Google service account key. Vercel issues each deployment a
short-lived OIDC token; Google's workload identity federation is configured to
trust that issuer and exchanges it for credentials of a deployer service
account. Two kinds of token come out of that:

- an **access token**, which lets Cira use Cloud Build, Cloud Run and Storage,
  and read Cloud Logging for runtime logs;
- an **identity token** per app, which Cloud Run checks before a request reaches
  the app. This is what makes every app unreachable except through Cira.

Nothing long-lived exists, so there is nothing to leak or rotate.

### 9. Runtime logs

Whoever manages an app can read what it printed while it ran, and every
request that reached it, at `/{space}/{app}/logs`. A console run that fails
links there too, opened on the minute either side of the run. Logs are fetched
from Cloud Logging when the page asks and handed straight to the browser: Cira
keeps no copy, the same rule as build logs and console runs.

The query is built on the server (`packages/deploy/src/cloudrun/runtime-logs.ts`).
The service it reads is taken from the app's own deployment record, never from
the browser, and the one piece of text a person supplies, the search, goes
inside an escaped string, so nothing typed can widen it to another app. People
who can only use an app do not see its logs: a log holds every user's requests
and whatever the app chose to print.

Google allows about sixty log reads a minute for the whole project, so Live
asks for new lines every ten seconds, stops in hidden tabs, and backs off when
Google says it is busy. The page also reads each of an app's workers and
scheduled runs, picked from a list.

### 10. Workers and scheduled runs

Not everything a company runs answers requests. A **worker** runs all the time
with no web port - a queue consumer, or a process keeping its own timetable,
like Wave's `arq`. A **scheduled run** is a command run to completion on a
timetable. Both run from the app's own image with a different command, so they
never drift from it.

Nobody writes them down for Cira. The CLI reads the files a repository already
has (`packages/core/src/processes.ts`):

| File                      | Becomes                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `Procfile`                | every line but `web` and `release` is a worker                  |
| `fly.toml` `[processes]`  | every process group that takes no web traffic is a worker       |
| GitHub Actions `schedule` | a workflow that runs a script on a timetable is a scheduled run |

A repository whose files name no web process is an app with no web process: it
deploys with no service and no address, and its page says it runs in the
background. Everything found starts **off**. Whoever manages the app turns it
on from the Processes section of its page, gives a scheduled run its timetable
(five-field cron, in UTC, shown in words) and its time, or runs one now.

On Google a scheduled run is a Cloud Run Job, started on its timetable by a
Cloud Scheduler job calling Google directly as the deployer account - Cira is
never the clock. A worker is a Cloud Run worker pool held at one instance or
none. Both are created during a deploy, the only moment Cira holds the app's
environment, and move onto the new image when the build finishes; switching
one on or off afterwards touches nothing secret. A run is always stopped a
minute before its next one could start, so runs never overlap without Cira
having to watch them.

Whether each is running, when it last ran, how that went and when it runs next
is shown to anyone who can open the app, on its page and through `app_status`,
because "did the report go out?" should not need an admin. The commands, the
logs and the controls are for whoever manages it; for them `app_status` also
carries a worker's latest log lines and those of a failed run
(`apps/web/src/lib/app-status.ts`).

Each is given one CPU and its own memory, read from the repository like
everything else: a `fly.toml`'s `[[vm]]` (`memory`, `memory_mb` or `size`, for
the groups it lists or all of them), or an `app.json`'s dyno `size` for a
Procfile's processes. What is asked for is rounded up to 512 MB, 1, 2 or 4 GB;
anything larger gets 4 GB and the CLI says so. A repository that says nothing
gets 1 GB, since running out of memory is how a worker most often fails and
memory is the cheap part of the bill. Cloud Run kills a process that goes over
and, for a worker, restarts it while still calling it ready, so Cira looks for
the out-of-memory line in a worker's logs and the reason on a failed run, says
so on the page and through `app_status`, and offers the next size up in one
click. Memory someone chose on the page outlasts redeploys.

A space may have 10 scheduled runs and 2 workers on, at most every 5 minutes,
10 minutes a run by default and 60 at most (`limits.ts`). A worker costs money
every hour it is on, about $50 to $65 a month depending on its memory, which
the page says beside it.

## Design principles

- **The app was not written for Cira.** A repository deploys as it is. Services,
  build method, environment needs and capabilities are all worked out from what
  the code already says.
- **The running app is the source of truth.** Reading source proposes; the
  deployed app confirms. Whether a route exists, whether an app has a front
  door, whether Cira may call something: all are asked of the app.
- **A conduit, not a vault.** Secret values pass through Cira and are never
  stored. See [`docs/secrets.md`](docs/secrets.md).
- **One rule, every reader.** Access, publication and verification are each
  decided in one place, so the gallery, the CLI and an agent always get the
  same answer.
- **Replaceable at the seams.** Identity is behind `lib/identity.ts`; compute is
  behind `DeploymentProvider`. The rest of Cira talks to its own model.
- **Checks on the server.** Nothing a client sends about who it is or which
  space it is in is trusted.

## Known limits

These are real gaps, not planned features in disguise.

- **Apps with their own sign-in cannot be called by agents.** Cira reaches an
  app as a service, not as one of its users. Their capabilities are discovered
  and shown as `refused`, with the reason.
- **A process a repository does not mention cannot be added from the page.**
  Workers and scheduled runs are created at deploy, when the app's environment
  is in hand; adding one is a line in the Procfile, and it appears on the next
  deploy. A Procfile's `release` command is not run.
- **No backing services.** Cira does not provision databases or caches; an app
  needs connection strings to services that already exist.
- **Cold starts.** Apps scale to zero, so the first request after a quiet
  period waits for an instance to start.

## Development

Requires Node 22 or later and pnpm.

```sh
pnpm install
cp .env.example .env.local      # then fill in the values
pnpm dev                         # the web app

pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm build
```

The build needs no secrets: every page that reads data renders on demand, so
CI builds without a database or auth keys.

### A local database

Never point `pnpm dev` at production's `DATABASE_URL`: every app you create
while clicking around would be real, and so would every deletion. Use a
disposable one:

```sh
docker compose -f docker-compose.dev.yml up -d

export DATABASE_URL=postgresql://postgres:postgres@db.localtest.me:55440/main
export DATABASE_URL_UNPOOLED=$DATABASE_URL
pnpm --filter @cira/db db:migrate
pnpm dev
```

It is two containers, Postgres and a Neon HTTP proxy, because Cira talks to
Neon over HTTP rather than the Postgres wire protocol. Using a different driver
locally would be simpler and wrong: an ordinary driver holds transactions open
across statements and Neon's HTTP driver cannot, so code that could never work
in production would appear to work here. Writes that must land together use
`atomically` from `packages/db`, which sends them as one batch that Neon runs
in a transaction.

`db.localtest.me` resolves to 127.0.0.1 from public DNS, so nothing goes in
`/etc/hosts`. Clerk runs in test mode: sign in with a `+clerk_test` address and
the code `424242`. `docker compose -f docker-compose.dev.yml down -v` throws
the data away.

When sourcing `.env.local` in a shell, keep its values quoted. A Neon URL ends
in `&channel_binding=require`, and an unquoted `&` makes bash print the whole
line, password included.

### Tests that need a database

About forty tests run against a real Postgres, because the schema's
constraints are part of what they check. Without `TEST_DATABASE_URL` they are
**skipped**, which is easy to miss on a green run:

```sh
docker run -d --name cira-test-pg -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=cira_test -p 55439:5432 postgres:18-alpine

TEST_DATABASE_URL=postgresql://postgres:test@localhost:55439/cira_test pnpm test
```

Each run creates and drops its own schema, so the container can stay up.

### A company to look at

A synthetic company - twenty-two people, ten teams, ten apps, forty-one
capabilities, and access grants that disagree with the org chart the way real
ones do:

```sh
pnpm --filter @cira/db build
pnpm --filter @cira/db db:seed:demo -- --owner you@example.com
pnpm --filter @cira/db db:seed:demo -- --remove
```

`--owner` must be an account that has signed in once. `--also a@b,c@d` adds
more real accounts as admins. Everything the seed writes is marked in its ids,
so `--remove` removes exactly that.

## Shipping

`prod` is the production branch. There are no pull requests or preview
environments. A push to `prod` runs typecheck, lint, format, build and the
full test suite, including the database tests; a green run migrates the
database and deploys to Vercel.

After changing an environment variable in Vercel, run the `ci` workflow by
hand (`gh workflow run ci --ref prod`). `NEXT_PUBLIC_` values are compiled into
the build, so they need a fresh one; redeploying from Vercel reuses the old
output, with the old values still in it.

Migrations run **before** the new code is live, so the previous deployment
briefly serves against the new schema. Every migration therefore has to be
additive: expand first, and contract in a later deploy once nothing reads the
old shape.

### Watching Cira itself

Errors in the web app, on the server and in the browser, go to Sentry
(project `cira-web` in the `cira` organization). Only production reports:
it is the only environment given `NEXT_PUBLIC_SENTRY_DSN`. A report carries
where a request went and what broke, never what the request carried - body,
cookies, query and all headers but the browser's name are removed before it
leaves (`lib/sentry-options.ts`), because a deploy request holds an app's
secrets. No session replay, for the same reason. Reports from the browser go
through `/monitoring` on Cira's own domain so ad blockers do not drop them,
and source maps are uploaded at the end of the production build, then deleted
rather than served.

`/api/health` is for an uptime monitor to ask every minute. It is up (200)
only when the app is serving, its database answers and the app proxy turns a
stranger away in its own words, which shows the Worker itself is running; it
answers 503 naming each part that is not, and says nothing else. One Sentry
uptime monitor watches it, since Sentry's free plan has one, and keeps the
body of a failed check, so its alert says which part broke.
`/api/health/proxy` asks about the proxy alone.

### What a company pays

Placeholders, set from what Cira measured of its own costs rather than from a
market (`plans.ts`). An app that scales to zero costs cents a month; a worker
that never scales down costs about $52; the fixed bill is tens of dollars
whatever anyone deploys. So the price is per person, where the value is, and
a worker is charged for on its own, because it is the one thing a customer
can switch on that costs money every hour.

| Plan  | Costs                                                        | Allows                                    |
| ----- | ------------------------------------------------------------ | ----------------------------------------- |
| Trial | free for 14 days                                             | one worker, otherwise the standard limits |
| Team  | $12 per person a month, 5 minimum, plus $75 a worker a month | the standard limits from `limits.ts`      |

A space's plan is a column on `spaces`, read where a limit is enforced - one
more app, one more worker - so a plan allows exactly what its page promises.
Nothing charges yet; Stripe is 2.2.

### Taking money

Stripe, over its REST API rather than its SDK: a few calls and a signature
check are not worth a dependency in every server bundle (`lib/billing.ts`).
Cira never sees a card. An admin is sent to Stripe's hosted checkout with a
line for the space's seats and one for each worker, and comes back to the
usage page; afterwards they change cards and read invoices in Stripe's own
billing portal.

What a subscription _means_ arrives only by webhook at `/api/stripe/webhook`,
whose signature is checked before the body is read as anything (a redirect can
be faked, and a person can close the tab). It sets the space's plan through
one rule in `lib/billing-rules.ts`: a late payment changes nothing but the
banner, because Cira is where a company's software lives and switching it off
over an expired card would hurt them more than the unpaid month hurts Cira; a
subscription that is actually over falls back to what a trial allows, and
deletes nothing. The watcher keeps the seat and worker counts in step with
what the space really has.

### Keeping an app warm

An app scales to zero, so the first request after a quiet spell waits for a
container to start. Its managers can keep one instance running from the app's
settings, which removes the wait and costs about $50 a month, all the time -
so it is a paid plan's option, billed as its own line rather than hidden in
the seat price. It survives a deploy: the count is read back off the service
when the new build rolls out, the same way the environment is.

### What a company costs to run

Every company's apps run in one Google project on one bill, so nothing in
Google says whose is whose. Cira knows: a deployment names the Cloud Run
service it made and a process names its job or worker pool, so Cloud
Monitoring is asked what each ran for - in instance-seconds, the unit Cloud
Run bills in - and `lib/usage.ts` adds it up per app. `pricing.ts` holds the
rates that turn that into money, the same ones that estimate a worker's
monthly cost beside its switch.

Admins and owners see it at `/{space}/~/usage`: the month so far, per app,
with deploys, capability runs and questions asked beside it. It is an
estimate of Cira's cost, not an invoice, and it is the number a plan has to
cover.

### Telling people when something breaks

Whoever manages an app - its owner and the space's admins - is emailed when a
deploy of it fails, when it stops answering, when a worker keeps stopping,
when a scheduled run fails, and when a capability that worked stops letting
Cira in. And when an app or worker that stopped is back. Invitations to a
space are emailed too, with the link still shown to the inviter.

Each event is claimed in `notifications` under a key naming it before any
email goes (`lib/notify.ts`), so the CLI, a page and the watcher noticing the
same failure at once send it once, and nothing is ever sent twice. Email goes
through Resend (`lib/email.ts`) and only when `RESEND_API_KEY` is set;
without it, events are still recorded and nothing is sent.

Most of Cira finds things out when someone looks. The watcher
(`lib/watch.ts`) looks without being asked, every five minutes on Vercel Cron
(`/api/cron/watch`, `vercel.json`): it settles deploys nobody stayed to
watch, asks each running app for `/` (any answer short of a server error
counts, and two misses in a row are an outage, so a slow cold start is not),
and reads each app's workers and scheduled runs.

### The app proxy

The worker is **not** deployed by CI. Pushing a change to it does nothing, and
the old code keeps running with no error to say so:

```sh
pnpm --filter @cira/app-proxy build
CLOUDFLARE_ACCOUNT_ID=... CIRA_ORIGIN=https://cira.dev CIRA_APPS_DOMAIN=cira.dev \
  CIRA_PROXY_SECRET=... pnpm --filter @cira/app-proxy ship
```

The script is `ship` because pnpm has a built-in `deploy` that shadows it. The
Cloudflare token is read from `~/.cloudflare-token` or `CLOUDFLARE_API_TOKEN`,
and needs Workers Scripts:Edit on the account plus DNS:Edit and Workers
Routes:Edit on the zone.

### Configured outside the repository

None of this is recreated by a deploy.

| Where          | What                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Cloudflare DNS | `*` CNAME, **proxied**, so app hostnames reach the worker                                                    |
| Cloudflare DNS | apex and `www`, **unproxied**. If they turn orange, the wildcard route sends Cira itself to the worker       |
| Cloudflare     | route `*.cira.dev/*` to `cira-app-proxy`                                                                     |
| Vercel         | environment variables, including `CIRA_APPS_DOMAIN` and `CIRA_PROXY_SECRET`                                  |
| GitHub         | secrets `DATABASE_URL_UNPOOLED` (for migrations) and `VERCEL_TOKEN`                                          |
| GitHub         | secret `SENTRY_AUTH_TOKEN`, an organization token that uploads source maps during the production build       |
| Vercel         | `NEXT_PUBLIC_SENTRY_DSN`, production only, a config value since the browser needs it                         |
| Vercel         | `CRON_SECRET`, production only, which Vercel Cron sends and `/api/cron/watch` requires                       |
| Vercel         | `RESEND_API_KEY`, production only, for all of Cira's email                                                   |
| Vercel         | `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, production only                                             |
| Stripe         | products and prices with the lookup keys `cira_team_seat` and `cira_team_worker`, and the webhook endpoint   |
| Cloudflare DNS | Resend's records for `cira.dev` (DKIM at `resend._domainkey`, MX and SPF at `send`), so its email is trusted |
| Sentry         | uptime monitors on `https://cira.dev/api/health` and `https://cira.dev/api/health/proxy`, alerting by email  |
| Google IAM     | the deployer service account holds `roles/iam.serviceAccountTokenCreator` **on itself**                      |
| Google IAM     | the deployer service account holds `roles/artifactregistry.repoAdmin`, so removing an app deletes its images |
| Google IAM     | the deployer service account holds `roles/logging.viewer`, so managers can read their apps' runtime logs     |
| Google IAM     | the deployer service account holds `roles/cloudscheduler.admin`, so scheduled runs can be given timetables   |
| Google IAM     | the deployer service account holds `roles/monitoring.viewer`, so each company can be shown what it used      |
| Google APIs    | Cloud Scheduler (`cloudscheduler.googleapis.com`) is switched on for the project                             |

`CIRA_PROXY_SECRET` must be identical in Vercel and the worker: Cira signs with
it and the worker verifies with it, so a mismatch locks everyone out of every
app. Without the token-creator binding, minting identity tokens fails and every
app becomes unreachable, to browsers and agents alike.

## The CLI

Install with `npm install -g @cira-app/cli`.

| Command                  | Does                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `cira login`             | Connects this machine to your Cira account, and offers to install the Cira Skill      |
| `cira deploy`            | Deploys this folder. `--space`, `--env-file`, `--env K=V`, `--no-env`, `--dockerfile` |
| `cira status`            | Shows what this folder is linked to                                                   |
| `cira remove`            | Takes this folder's app down and deletes what it left behind                          |
| `cira mcp connect`       | Points this machine's AI assistants at Cira. `disconnect` undoes it                   |
| `cira skill install`     | Installs the Cira Skill into your coding agents                                       |
| `cira update`            | Updates the CLI and the Skill copies you approved                                     |
| `cira whoami` / `logout` | Shows or forgets the stored credential                                                |

### The Cira Skill

Coding agents learn Cira from one file, `packages/cira-skill/SKILL.md`. There is
no per-agent version: agents differ in where a skill lives, not in what Cira
wants them to know.

| Agent       | Where it goes                         |
| ----------- | ------------------------------------- |
| Claude Code | `~/.claude/skills/cira/`              |
| Codex       | `~/.agents/skills/cira/`              |
| Pi          | `~/.agents/skills/cira/`              |
| Gemini CLI  | `~/.agents/skills/cira/`              |
| Cursor      | `.cursor/rules/cira.mdc`, per project |

Nothing is installed by a postinstall script. `cira login` asks once, and
declining writes nothing. `cira update` re-syncs only the agents you approved.
Other commands check for a new release at most once every 8 hours, never block
on it, and mention it once.

### Publishing a release

```sh
npm version patch --workspace @cira-app/cli     # or minor / major
git push --follow-tags
```

The tag triggers `.github/workflows/publish.yml`, which authenticates to npm
over OIDC (trusted publishing, so there is no npm token anywhere) and attaches
provenance. It **stages** the release rather than publishing it: promote it
from the package's page on npmjs.com. A compromised workflow can therefore
upload a release but cannot put it in front of anyone, which matters for a CLI
that writes instructions into coding agents.

The package is one self-contained file with no runtime dependencies. Cira's
internal packages are bundled into it rather than published, and `SKILL.md` is
copied in beside it.
