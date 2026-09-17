# Cira

**Cira lets developers deploy software directly to their company, and lets employees use that software from one simple place.**

Developers run `cira deploy`. Employees open Cira and see the apps they have access to. Nobody configures cloud infrastructure.

The full product spec lives in [`docs/spec.md`](docs/spec.md); the build order and current progress live in [`CHECKLIST.md`](CHECKLIST.md).

## Shape

```text
User → Space → Apps
```

A **Space** is usually a company. Apps belong to a space, and each app is visible
to whoever its access rules name. That is the whole mental model.

## Layout

```text
apps/
  web/        Next.js app - employee gallery, app management, MCP endpoint
packages/
  core/       Domain model, permission logic, deployment provider interface
  db/         PostgreSQL schema and migrations
  deploy/     Deployment provider implementations
  extract/    Reads a repository's shape, for capability analysis
  cira-skill/ The Cira Skill, as one canonical SKILL.md
  cli/        The `cira` command
```

`packages/core` holds no framework and no provider code. Permission checks take
explicit records and are always run server-side - client-supplied space and user
ids are never trusted.

## Stack

| Concern  | Choice                                       |
| -------- | -------------------------------------------- |
| Web      | Next.js 16, React 19, Tailwind v4            |
| Database | Neon Postgres                                |
| ORM      | Drizzle                                      |
| Identity | Clerk, behind `apps/web/src/lib/identity.ts` |
| Hosting  | Vercel for Cira, Cloud Run for deployed apps |
| Analysis | Claude, behind `lib/capability-analyzer.ts`  |

Two seams keep the replaceable parts replaceable. `lib/identity.ts` is the only
module that imports the auth provider, and `DeploymentProvider` is the only way
Cira reaches compute. Everything else talks to Cira's own model.

Reasoning for each choice is recorded in [`CHECKLIST.md`](CHECKLIST.md).

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install
cp .env.example .env.local     # then fill in the values
pnpm --filter @cira/db db:migrate
pnpm dev                        # run the web app

pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm build
```

The build needs no secrets; every page that reads data is server-rendered on
demand, so CI builds without a database or auth keys.

Point `DATABASE_URL` at a local database rather than a real one before running
`pnpm dev`. The next section sets one up.

### Developing against a local database

`pnpm dev` with a `DATABASE_URL` copied from production means developing _in_
production: every app created while clicking around is a real app, and every
deletion is a real deletion. This gives you somewhere disposable instead.

```sh
docker compose -f docker-compose.dev.yml up -d

export DATABASE_URL=postgresql://postgres:postgres@db.localtest.me:55440/main
export DATABASE_URL_UNPOOLED=$DATABASE_URL
pnpm --filter @cira/db db:migrate
pnpm dev
```

`db.localtest.me` resolves to 127.0.0.1 from public DNS, so nothing needs
adding to `/etc/hosts`, and no production address can ever be mistaken for it.

Two containers rather than one, because Cira talks to Neon over HTTP instead of
the Postgres wire protocol: a plain local Postgres is unreachable by the driver
the application uses. The proxy answers Neon's HTTP protocol and speaks
ordinary Postgres to the container behind it.

It is worth knowing why this is not solved by letting the application pick a
different driver when it sees a local address, which is smaller and obvious.
Neon's HTTP driver cannot do transactions and an ordinary Postgres driver can,
so local work would silently gain a capability production does not have. The
first `db.transaction()` anyone wrote would pass every test here and throw in
production. Running the real driver against a real proxy means a thing that
cannot work in production does not appear to work here either.

Clerk is in test mode, so signing in locally uses a `+clerk_test` address with
the verification code `424242`. The first sign-in creates the local user, and
`db:seed:demo` below can then fill the database with something to look at.

The volume keeps the data between runs. `docker compose -f
docker-compose.dev.yml down -v` throws it away.

### The tests that need a database

`pnpm test` silently skips around forty of them. The journey and capability
tests run against a real Postgres, because the constraints _are_ the safety -
a fake would pass while the real schema rejected the same writes, which is
precisely what those tests exist to catch. Without `TEST_DATABASE_URL` they are
reported as skipped, which is easy to read past on a green run and is how a
breakage reaches CI instead of stopping locally:

```sh
docker run -d --name cira-test-pg -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=cira_test -p 55439:5432 postgres:18-alpine

TEST_DATABASE_URL=postgresql://postgres:test@localhost:55439/cira_test pnpm test
```

Each run builds its own schema in a fresh database and drops it afterwards, so
the container can stay up between runs.

### A company to look at

An empty account says very little about the product. This builds a whole
synthetic one - twenty-two invented people across ten teams, ten internal apps,
forty-one capabilities, and grants that disagree with the org chart the way real
ones do:

```sh
pnpm --filter @cira/db build
pnpm --filter @cira/db db:seed:demo -- --owner you@example.com
pnpm --filter @cira/db db:seed:demo -- --remove
```

`--owner` has to be an account that has signed in at least once, so Cira knows
who it is; it becomes the owner of the space. `--also a@b,c@d` drops further
real accounts in as admins, for a machine with more than one login. Everything
the seed writes is marked in its ids, so `--remove` is exact rather than a
guess. Source: [`packages/db/src/seed`](packages/db/src/seed).

## Shipping

`prod` is the production branch. Push to `prod` and CI runs typecheck, lint,
format, build and tests; a green run deploys. There are no pull requests and no
preview environments by design - see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Deployment providers

Cira does not own compute. Everything routes through the `DeploymentProvider`
interface in `packages/core`, so the provider can be replaced without touching
anything above it.

Google Cloud Run runs the deployed apps. Cloud Build turns uploaded source into
an image with buildpacks, which detect the language themselves - so Cira deploys
whatever an internal tool happens to be written in, rather than only the half of
it that is a frontend.

It was chosen for its access model as much as its runtime. A Cloud Run service
is unreachable until something is granted the invoker role, and Cira grants
nothing: it calls each app with an OIDC token addressed to that app's own URL,
which Cloud Run checks before the request arrives. That is the access gateway
from spec section 7, without building one, and without a shared secret in a
column anywhere.

Cira itself still runs on Vercel, and that is load-bearing rather than
incidental: Vercel issues every deployment a short-lived OIDC token, which is
what Cira exchanges for Google credentials. There is no service account key.

## Opening a deployed app

Apps run on Cloud Run, which is private: it wants a Google identity token on
every request, and a browser cannot put a header on a navigation. So each app
gets its own hostname and a Cloudflare Worker in front of it holds the token.

```
browser  ->  ledger--acme.cira.dev        Cloudflare, free wildcard certificate
         ->  workers/app-proxy            verifies Cira's signed session
         ->  {service}.run.app            Cloud Run, still IAM-private
```

The double hyphen is load-bearing. Slugs collapse runs of non-alphanumerics to
a single hyphen, so no slug can contain `--`, which makes it a separator
nothing else can produce - that is what keeps `acme-corp` + `ledger` distinct
from `acme` + `corp-ledger`. One label rather than two, because a wildcard
certificate matches exactly one: `*.cira.dev` covers `ledger--acme.cira.dev`
and not `ledger.acme.cira.dev`, and the first is free. It also means Cira's own
names can never be claimed by naming an app badly, since every app address
contains `--` and no ordinary hostname does.

The proxy decides nothing. Cira checks who someone is and whether they may open
the app, then signs a token saying so; the proxy verifies the signature and
forwards. Signing rather than asking avoids a round trip for every image on a
page, and the cost is that revoking access takes effect when the token expires

- `SESSION_SECONDS` in `packages/core/src/proxy-session.ts`, fifteen minutes.

### Deploying the proxy

Nothing deploys it automatically. Cira itself ships through CI on every push,
so a change to the web app is live minutes later; the worker in the same
repository does not work that way, and editing it and pushing does nothing at
all - the old code keeps running with no error anywhere to say so.

```sh
pnpm --filter @cira/app-proxy build
CLOUDFLARE_ACCOUNT_ID=... CIRA_ORIGIN=https://cira.dev CIRA_APPS_DOMAIN=cira.dev \
  CIRA_PROXY_SECRET=... pnpm --filter @cira/app-proxy ship
```

`ship`, not `deploy`: pnpm has a built-in command by that name which shadows a
script and fails with an error about deploy targets.

The Cloudflare API token is read from `~/.cloudflare-token`, or
`CLOUDFLARE_API_TOKEN` if set. It needs Workers Scripts:Edit on the account,
and DNS:Edit plus Workers Routes:Edit on the zone.

### What is configured outside the repository

Four things, none of which a deploy recreates:

| Where          | What                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare DNS | `*` CNAME, **proxied**, so app hostnames reach the worker                                                                           |
| Cloudflare DNS | apex and `www`, **unproxied** - they must stay grey, or the wildcard route sends them to the worker, which has no app to serve them |
| Cloudflare     | a route `*.cira.dev/*` to `cira-app-proxy`                                                                                          |
| Vercel         | `CIRA_APPS_DOMAIN` and `CIRA_PROXY_SECRET`, on all three environments                                                               |

`CIRA_PROXY_SECRET` is the same value in both places. Cira signs with it and
the worker verifies with it, so changing it in one place and not the other
locks everyone out of every app until they agree again.

Google needs one binding that is easy to miss: the deployer service account
must hold `roles/iam.serviceAccountTokenCreator` **on itself**, or minting an
identity token fails and every app becomes unreachable - to assistants as well
as to browsers, since capability calls use the same token.

## Capabilities

Deploying an app also publishes what it can _do_. Nobody writes a manifest:
`cira deploy` reads the repository, and Cira works out which routes are
business operations worth exposing.

```text
normal Next.js app → cira deploy → routes extracted → analyzed → registered
                                                                     ↓
                      agent ── MCP ──→ search → describe → invoke ───┘
```

Five pieces, each small:

| Piece              | Where                                   | Job                                             |
| ------------------ | --------------------------------------- | ----------------------------------------------- |
| Repo extractor     | `packages/extract`                      | Recovers routes, functions and schemas          |
| Analyzer           | `apps/web/src/lib/capability-analyzer`  | One model call: which of these are operations   |
| Grounding          | `apps/web/src/lib/capability-grounding` | Refuses anything without a real route behind it |
| Registry           | `apps/web/src/lib/capabilities`         | Stores them, inherits the app's access rules    |
| Invocation gateway | `apps/web/src/lib/invoke-capability`    | Checks, validates, and calls the deployed app   |

Publication is deliberately cautious. A confident read-only capability enables
itself; anything that writes is registered and left off until someone turns it
on from the app's page, and anything destructive stays off. A redeploy replaces
the set but never overrides a decision a person already made.

Agents connect over MCP at `/api/mcp` with a `cira login` token, and get three
tools - `search_capabilities`, `describe_capability`, `invoke_capability` -
whatever the company has deployed. A capability can only ever address the app
it came from: it carries a method and a root-relative path, and the host is
resolved from that app's own deployment.

## Publishing the CLI

Tag a release and GitHub Actions publishes it:

```sh
npm version patch --workspace @cira-app/cli   # or minor / major
git push --follow-tags
```

There is no npm token in this repository. `.github/workflows/publish.yml`
authenticates over OIDC using npm's trusted publishing, which mints a
short-lived credential for that one run - nothing to leak, nothing to rotate,
and npm is removing direct publishing by granular token in January 2027 anyway.
It also attaches provenance, so anyone can verify a release came from this
repository.

The workflow **stages** the release rather than publishing it; you promote it
from the package's page on npmjs.com. A compromised workflow can therefore
upload an artifact but cannot put it in front of anyone - which matters here,
because this CLI writes instructions into the coding agents on a developer's
machine.

`@cira-app/cli` ships as a single self-contained file with **no runtime
dependencies**. `@cira/core`, `@cira/deploy`, `@cira/extract` and `@cira/skill`
are bundled into it rather than published: they are Cira's own internals with
no consumers outside this repository, and publishing them would mean committing
to their names and APIs in public, for nobody.

The canonical `SKILL.md` is copied in beside the bundle, which is where the CLI
reads it from at runtime.

## The Cira Skill

Coding agents learn Cira from one file: `packages/cira-skill/SKILL.md`. There is
no per-agent version - agents differ in where a skill lives and what wrapper it
needs, not in what Cira wants them to know.

`cira login` offers to install it into whatever it finds, defaulting to yes:

```text
  Coding agents detected:

    Claude Code
    Codex
    Cursor

  Install the Cira Skill? [Y/n]
```

Declining writes nothing, and `cira skill install` does it later. Nothing is
installed by a postinstall script: onboarding asks, once, where you can see it.

| Agent       | Where it goes            | Note                                    |
| ----------- | ------------------------ | --------------------------------------- |
| Claude Code | `~/.claude/skills/cira/` | Reads only its own directory            |
| Codex       | `~/.agents/skills/cira/` | Shared                                  |
| Pi          | `~/.agents/skills/cira/` | Shared                                  |
| Gemini CLI  | `~/.agents/skills/cira/` | Shared, and takes precedence for it     |
| Cursor      | `.cursor/rules/cira.mdc` | Per project - Cursor has no global path |

Five agents, three files. Codex, Pi and Gemini CLI all read `~/.agents/skills`,
so Cira writes there once rather than into three private directories - and an
agent that adopts the same convention later needs no code here at all.

## Staying current

```sh
cira update
```

Checks the registry directly, updates the CLI through npm - the mechanism the
install instruction already uses - and then re-syncs the skill into the agents
you approved, and only those. An agent installed since is left alone; so is one
whose auto-update you declined.

Normal commands check quietly at most once every 8 hours, never block on the
answer, and mention a release only once:

```text
  Cira 0.2.0 is available.
  Run `cira update`.
```

A check that is slow, offline, or hits a registry that has never heard of Cira
is abandoned without a word.
