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
space for their company or joins one. People arrive through an invite link,
which only the invited address can use. A space founded with a company email
records that domain, and an admin can choose, in the space's settings, to let
anyone with a verified address there join as a member without an invite; it is
off until someone turns it on. Personal providers (Gmail, Outlook, web.de, QQ
and about 190 more) and university addresses never count as a company domain.

The members page is where a company looks after its people. Admins change
roles, remove people, revoke invites that are out and make teams; anyone can
leave. A space can have several owners, only an owner makes or changes one,
and the last owner cannot leave until there is another. Removing someone takes
away their access everywhere at once - including their CLI and any assistant
they connected, since every token is checked against membership - hands the
apps they owned to whoever removed them, and stops them rejoining by domain
until they are invited again.

### 2. Connecting a machine

`cira login` uses a device flow, so no password or secret is ever typed into a
terminal:

```text
cira login ──▶ POST /api/cli/auth/start      gets a device code and a short user code
           ──▶ opens cira.dev/cli            the person, already signed in, approves the code
           ──▶ POST /api/cli/auth/poll       returns a token once approved
```

The token is stored in `~/.cira/config.json` (or given as `CIRA_TOKEN`, which
is how a CI job deploys). It deploys and removes the apps its owner manages.
Assistants never get it: `cira mcp connect`, and the Connect your assistant
panel in the app, give them a token of their own that reaches MCP and nothing
else, as the same person. Every token lapses after ninety days unused, and each
use moves that on, so a machine or a CI job in regular use never notices. The
panel lists every token that can act as a person, marked terminal or
assistants, each with a Revoke.

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

**The environment.** A deploy changes the variables it sends and leaves every
other one as it is in production, so a teammate's fresh clone or a CI job with
no `.env` changes nothing. The CLI layers `.env`, `.env.production`,
`.env.local` and `.env.production.local`, each overriding the one before, the
way Next.js and Vite read them for a production build, and then any `--env
KEY=value`. It scans the source for variables the code reads with no default,
or with a default pointing at `localhost`, asks Cira which names production
already has, and prints one checklist, marking each variable ✓ or ✗:

```text
Environment (from .env, .env.local)
  ✓ DATABASE_URL
  ✓ S3_ACCESS_KEY  already set in production
  ✗ REDIS_URL      defaults to localhost, in apps/api/app/config.py
```

For anything missing, it asks for the value in the terminal (masked), and
going without one means typing `skip` - pressing Enter does not. Taking a
variable away is explicit: `cira deploy --unset OLD_NAME`. It also lists every
variable a frontend build compiles into the JavaScript a browser downloads
(`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `PUBLIC_`, `EXPO_PUBLIC_`,
`NUXT_PUBLIC_`, `GATSBY_`), because anyone who opens the app can read those.
They are also the only variables the build itself is given - as `--env` to
buildpacks, or as `--build-arg` to a Dockerfile that declares the `ARG` - so
they are in the bundle rather than `undefined`.

Values are never stored by Cira. They travel with the deploy request, are
written onto the Cloud Run service in a revision that takes no traffic, and go
live together with the new build; a build that fails leaves the app as it was.
Cira keeps each variable's name, an 8-character fingerprint and who set it, so
the app page can show what is configured and when it changed. The full design
is in [`docs/secrets.md`](docs/secrets.md).

**The upload.** What is sent is what the build would be sent anyway: for a
Dockerfile, `docker build`'s view of the folder, so `.dockerignore` decides;
otherwise the repository's `.gitignore` files, each for its own directory.
`.ciraignore`, in the same syntax, applies to both and has the last word.
Dependencies, caches, virtual environments (found by their `pyvenv.cfg`,
whatever they are called), `.git` and `.env` files are never sent. Neither is
anything that holds a credential by convention - `.streamlit/secrets.toml`,
`config/master.key`, `credentials.json`, `.npmrc`, a `.pem` with a private key
in it - which the CLI names as it holds them back; a `!path` line in
`.ciraignore` sends one anyway. The archive goes straight from the CLI to Cloud
Storage with a signed URL that allows writing one object once. It never passes
through Cira, which is what lets a real project deploy at all: Vercel caps
request bodies far below the size of one.

**One app out of a workspace.** Run from inside a package of a pnpm, yarn,
npm or bun workspace - `apps/web` in a Turborepo - `cira deploy` uploads the
workspace root, leaving out its other apps, and deploys that one package. A
package with its own Dockerfile uses it; a Python or Go package is built by
buildpacks at its path; a JavaScript package gets a Dockerfile Cira writes into
the upload (never the repository) that installs from the root lockfile with
the workspace's own manager, builds the package after its dependencies (with
turbo when there is a `turbo.json`), and starts it with its `start` script
(`packages/cli/src/workspace.ts`). From the root, a workspace with several
apps prints the `cd <app> && cira deploy` for each.

**Sites with no server.** A Vite, Create React App, Astro, Vue CLI or Parcel
app with a `build` script and no `start` script, or a folder whose root is an
`index.html`, is a static site: Cira builds it with the repository's own
package manager, with its browser-public variables, and serves the output with
nginx on Cloud Run's port, sending any path the site does not have to its
`index.html` so a client-side router works (`packages/cli/src/static-site.ts`).
A start script or a Dockerfile always wins over this, and so does anything that
renders on a server (Next.js, Nuxt, Remix, SvelteKit).

**The release command.** A Procfile `release:` line, or fly.toml's
`[deploy] release_command`, runs once per deploy on the new build with the new
variables, before anything takes traffic - which is where a migration belongs.
It is a Cloud Run job of its own. When the build finishes, the provider holds
the rollout and says a release is needed; `lib/deployment-sync.ts` claims its
start with a conditional write on the deploy's row, so however many polls
arrive (the CLI, the app page, the watcher) it runs once, and rolls out only
when it succeeds. A failed release fails the deploy with nothing changed: the
previous version keeps serving, on the schema it expects.

**The build and the rollout.** `POST /api/cli/deploy` checks membership,
creates the app or - for a redeploy - checks the deployer may manage it (its
owner, an admin, or someone given "Can manage" in its Access panel), records
its services and starts one Cloud Build with a step per service. Starting a
deploy supersedes any older one of the same app still in flight, so a build
that finishes late never replaces newer code. Each service becomes a container in a single Cloud Run
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
Those are defaults. A repository that sizes its web process - a `fly.toml`
`[[vm]]` for the group that takes traffic, or an `app.json` `formation.web`
dyno - gets that, rounded up to 512 MB, 1, 2 or 4 GB, and anyone who manages
the app can choose a size under Settings, which stands over the repository's
on every later deploy (`appMemory` in `packages/core/src/limits.ts`). The size
is carried through each rollout and is what usage is priced at.

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
source into one document (lockfiles, generated code and binaries are left out;
files that look like they declare routes go first, then other code, then prose
and styles, then tests; and the whole is capped at 420 KB so it and a 64,000
token answer fit the model's context), and makes one streamed model call. An
answer too long to fit is asked for again as the 40 operations people would
use most. The model proposes operations an
employee would recognise, each with a name, a description, an HTTP method, a
root-relative path, an input schema and an example input. It is language-
agnostic: nothing about it knows what framework an app uses. The default model
is Claude Haiku 4.5; `CIRA_ANALYZER_MODEL` overrides it.

**Checks.** `capability-grounding.ts` decides what Cira is willing to store.
It needs no model: names must be well-formed, paths must be root-relative and
unable to leave the app's own host, and schemas must be valid. Anything else
is dropped. Whether it is a read or a write is decided by the method, not the
model: anything but `GET` or `HEAD` is a write, and the model can only make a
`GET` more cautious (`riskFor` in `packages/core/src/capability.ts`).

**Registry.** Capabilities are stored against their app. A redeploy replaces
the set, but a decision a person made survives it: re-detecting a write
someone turned off does not turn it back on. A decision is about what the
person saw, though: a capability whose risk rose, or a write whose method or
path moved, is switched off and goes back to review.

**Verification.** Reading code can be wrong, so nothing is offered to an agent
until the running app confirms it. First a control request to a random path
must return 404, otherwise the app answers everything and nothing can be
confirmed. Then:

- a **read** is actually called, with its example input;
- a **write** is never called. Its path is asked which methods it allows.

What the app says is recorded as the capability's `reach`:

| App's answer                  | `reach`    | What happens                                                             |
| ----------------------------- | ---------- | ------------------------------------------------------------------------ |
| 404                           | -          | Deleted. Nothing serves it; the analysis was wrong. (But see below.)     |
| 401 or 403                    | `refused`  | Kept and explained. The route is real, but the app will not let Cira in. |
| anything else, even 4xx / 5xx | `callable` | The app's own code ran, so Cira can reach it.                            |
| no answer                     | `pending`  | Left alone and asked again later.                                        |

Two answers need a second look. A read with an id in its path
(`/customers/{id}`) says 404 for a made-up id when the customer does not
exist, so its 404 is compared with the one the control got: a different
content type or body, or an `OPTIONS` that finds the route, means it is
served. When nothing can tell, it stays `pending` and is never deleted. And a
redirect is not a result: to a sign-in page (or another origin) it is
`refused`; anywhere else it stays `pending`. A write whose `OPTIONS` gives no
`Allow`, or answers every path alike the way CORS middleware does, is asked
with a `GET` instead, where a 405 means the path is served. A refusal met
while verifying as one person is not recorded for everyone.

A refusal belongs to the build that gave it. Once a different deployment is
live, it reads as `pending` again, so a developer who lets Cira in and
redeploys is heard. For a write, a method probe cannot tell an open route from
a guarded one, because frameworks reject a wrong method before they check who
is asking. So a write only counts as `refused` when a real call is turned
away (see below).

Verification runs after `cira deploy`, and again whenever someone opens an
app's page while anything is still unconfirmed. A real call that gets the app's
router 404 (the same page it gives a made-up path, not a handler's "no such
order") sends that capability back to be verified again, so a route the app
stopped serving is not offered forever.

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
| `invoke_capability`   | Runs it and returns the app's JSON. A write first asks its person (below).       |
| `app_status`          | Says whether an app is live and how its workers and scheduled runs are doing.    |

Fixed tools rather than one per capability, so a company's shelf can change
with every deploy without an agent re-reading a tool list.

An invocation passes, in order: the person's access to the app, the capability
being enabled and callable, and its input against the schema. Only then is a
URL built, from the app's own deployment plus the capability's path, so a
capability can never address anything but the app it came from. The
deployment is the newest one that went live, so capabilities keep working
while a new build runs or after one fails. The call carries an identity token
for that one app and nothing that identifies a person. A capability that
cannot be run says why - "not enabled" means ask an admin, "the app signs its
own users in" means no setting in Cira will help.

`GET`, `HEAD` and `DELETE` carry their input in the query, a list as the key
once per item (`?tag=a&tag=b`); anything else sends a JSON body. One
15-second deadline covers the whole answer, body included. A write whose
result Cira could not see - it timed out, trickled, or redirected - is
reported as "may still have been made", never as unreachable, because the
wrong answer there is a second refund. A write the app accepted with HTML is
reported as done. An agent is handed at most 100,000 characters of a result,
cut with a note asking for less when it is bigger.

A write that answers 401 to a real call is recorded as `refused`, so the next
agent is told before it tries. That only happens while calls identify nobody:
the headers are checked against an allow-list, so any future change that
passes a person's identity turns the recording off by itself.

A write asked for over MCP does not run on the first call. Cira records what
the assistant wants to do and answers `needs_approval` with a link to
`/approve/<id>`, where the person sees the app, the operation and every field
it would send, and approves or declines. The assistant then calls again with
the same input and the `approvalId`. An approval is for one person, one
capability and one input (compared by a canonical hash, so key order does not
matter and a changed amount does), runs once, and lapses after 15 minutes
(`lib/approvals.ts`). The assistant's own client asking first is not enough:
one "always allow" there and it never asks again. Ask Cira puts the same
question to the person in its own window before calling.

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
app sees them on its page under Capability runs, with "approved" on a write
its person approved. The same record is what limits a person to 60 runs a
minute: a run is written before its call and counted with itself in, so a
burst of parallel calls cannot all pass, and a run refused by that limit is
taken back out.

### 7. Access control

One rule decides who may open an app, and everything else follows from it:

1. You must be a member of the app's space. Membership alone grants nothing.
2. The app's owner can always open it.
3. Admins and owners of the space can open every app in it.
4. Otherwise, an access rule must name you, one of your teams, or the space.

Capabilities have no permissions of their own: you may discover and call a
capability exactly when you may open its app. Managing an app - deploying it,
settings, access, environment, deletion, turning capabilities on - is for its
owner, the space's admins, and anyone its Access panel says "Can manage" for,
directly or through a team. "Can manage" is never given to the whole space.
The rules live in `packages/core/src/permissions.ts` as pure functions and are
tested there.

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

### The public side

Signed out, `/` is a landing page rather than a redirect to sign-in, with
`/pricing`, `/docs` and `/legal/*` beside it (`components/site/`). Pricing is
rendered from `plans.ts` and `limits.ts` - the same record the server
enforces - so the page cannot promise an allowance the product refuses. The
legal pages say what Cira actually does, including what it does not hold and
what is not built, and carry a notice that they are drafts until a lawyer has
read them.

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
be faked, and a person can close the tab). An event is only a pointer: the
subscription is fetched as it is now, so Stripe delivering events out of order,
or retrying an old one, cannot put a space on the wrong plan. A second running
subscription for a space that already pays, or one for a space that no longer
exists, is cancelled. Checkout is offered only while a space is not paying
(the portal cannot start a subscription, so an abandoned or cancelled checkout
must not leave a space unable to pay again), and two clicks in the same minute
get the same checkout. Deleting a space expires any checkout still open.

What a plan allows is enforced, not only displayed (`lib/plan-enforcement.ts`,
run by the watcher and at once when a subscription ends). A trial lasts
fourteen days from the space's creation. After it, or after a subscription
ends or Stripe gives up on one (`unpaid`), the space has no plan: everything it
deployed still opens and nothing is deleted, but deploys are refused and
workers, scheduled runs and warm apps are switched off - the things that cost
money by the hour. A late payment (`past_due`) changes nothing but the banner,
because Cira is where a company's software lives and switching it off over an
expired card would hurt them more than the unpaid month hurts Cira. Admins are
emailed three days before a trial ends, when it ends, when a payment fails,
when a subscription ends and when anything is switched off.

The watcher keeps the subscription in step with what the space really has: a
seat per person (five at least), a line per worker and per warm app, added when
the first is switched on and removed when the last goes. One person may own at
most two spaces that have never been subscribed.

### Apps that sign their own users in

Cira calls an app as nobody: an identity token for that app and a strict
allow-list of headers, which is why an app with its own login answers 401 and
its capabilities are recorded as refused.

An app's managers can now turn on _Tell this app who is calling_. Cira then
sends `x-cira-identity`: an ES256-signed assertion naming the person - id,
name, verified email, their company, and whether a person or an agent is
asking - with the app's own origin as its audience and a sixty-second life
(`lib/identity-assertion.ts`). Apps verify it against
`/.well-known/cira-jwks.json`, which carries the current key and the one
before it so a rotation breaks nobody. Signing keys live in the environment,
never in the database.

Signed rather than merely sent, because an app is reachable through Cira's
browser proxy too, where the person controls their own headers. Off by
default, per app: an app not expecting a claim about a person never receives
one. Turning it on clears the refusals collected while Cira called as nobody
and asks the app again, as the person who turned it on.

The guard that made this safe was already there: `speaksForNobody` is an
allow-list, so the new header stops a 401 being recorded as a refusal against
everybody - a 401 now means that one person was turned away.

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

Whoever manages an app - its owner, the space's admins and anyone given
"Can manage" on it - is emailed when a
deploy of it fails, when it stops answering, when a worker keeps stopping,
when a scheduled run fails, and when a capability that worked stops letting
Cira in. And when an app or worker that stopped is back. Invitations to a
space are emailed too, with the link still shown to the inviter.

Each event is claimed in `notifications` under a key naming it before any
email goes (`lib/notify.ts`), so the CLI, a page and the watcher noticing the
same failure at once send it once, and nothing is ever sent twice. The message
and whoever it has not reached yet are kept on the row, so a send the email
provider refused or could not take is tried again by the watcher - up to five
times over a day - rather than lost. Sends are spaced to stay under Resend's
rate. A flood is held back: at most two outage emails about one thing in two
hours, one about a failing scheduled run in six, and no "back up" for an
outage nobody was told about; what was held back is recorded on the row. Email
goes through Resend (`lib/email.ts`) and only when `RESEND_API_KEY` is set;
without it, events are still recorded and nothing is sent.

Most of Cira finds things out when someone looks. The watcher
(`lib/watch.ts`) looks without being asked, every five minutes on Vercel Cron
(`/api/cron/watch`, `vercel.json`). It retries notices that did not go; then,
for every space, sends trial notices, switches off what its plan no longer
covers and keeps its subscription's quantities in step; then settles deploys
nobody stayed to watch, asks each running app for `/` (any answer short of a
server error counts, and two misses in a row are an outage, so a slow cold
start is not), and reads each app's workers and scheduled runs. An app with a
sidecar is billed for as long as an instance exists, so it is only asked while
someone would notice - kept warm, opened in the last hour or called in the last
fifteen minutes - rather than kept awake around the clock by the asking. A pass
stops starting new checks after four minutes.

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

| Where          | What                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare DNS | `*` CNAME, **proxied**, so app hostnames reach the worker                                                                                                                                       |
| Cloudflare DNS | apex and `www`, **unproxied**. If they turn orange, the wildcard route sends Cira itself to the worker                                                                                          |
| Cloudflare     | route `*.cira.dev/*` to `cira-app-proxy`                                                                                                                                                        |
| Vercel         | environment variables, including `CIRA_APPS_DOMAIN` and `CIRA_PROXY_SECRET`                                                                                                                     |
| GitHub         | secrets `DATABASE_URL_UNPOOLED` (for migrations) and `VERCEL_TOKEN`                                                                                                                             |
| GitHub         | secret `SENTRY_AUTH_TOKEN`, an organization token that uploads source maps during the production build                                                                                          |
| Vercel         | `NEXT_PUBLIC_SENTRY_DSN`, production only, a config value since the browser needs it                                                                                                            |
| Vercel         | `CRON_SECRET`, production only, which Vercel Cron sends and `/api/cron/watch` requires                                                                                                          |
| Vercel         | `RESEND_API_KEY`, production only, for all of Cira's email                                                                                                                                      |
| Vercel         | `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, production only                                                                                                                                |
| Stripe         | prices with the lookup keys `cira_team_seat`, `cira_team_worker` and `cira_team_always_on`, and the webhook (`customer.subscription.*`, `checkout.session.completed`, `invoice.payment_failed`) |
| Cloudflare DNS | Resend's records for `cira.dev` (DKIM at `resend._domainkey`, MX and SPF at `send`), so its email is trusted                                                                                    |
| Sentry         | uptime monitors on `https://cira.dev/api/health` and `https://cira.dev/api/health/proxy`, alerting by email                                                                                     |
| Google IAM     | the deployer service account holds `roles/iam.serviceAccountTokenCreator` **on itself**                                                                                                         |
| Google IAM     | the deployer service account holds `roles/artifactregistry.repoAdmin`, so removing an app deletes its images                                                                                    |
| Google IAM     | the deployer service account holds `roles/logging.viewer`, so managers can read their apps' runtime logs                                                                                        |
| Google IAM     | the deployer service account holds `roles/cloudscheduler.admin`, so scheduled runs can be given timetables                                                                                      |
| Google IAM     | the deployer service account holds `roles/monitoring.viewer`, so each company can be shown what it used                                                                                         |
| Google APIs    | Cloud Scheduler (`cloudscheduler.googleapis.com`) is switched on for the project                                                                                                                |

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
