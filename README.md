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
| Hosting  | Vercel                                       |
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

## Shipping

`prod` is the production branch. Push to `prod` and CI runs typecheck, lint,
format, build and tests; a green run deploys. There are no pull requests and no
preview environments by design - see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Deployment providers

Cira does not own compute. Everything routes through the `DeploymentProvider`
interface in `packages/core`, so the provider can be replaced without touching
anything above it.

Vercel is the first provider, chosen because V1 targets Next.js only. Deployed
apps keep Vercel's Deployment Protection on, so their raw URL is not publicly
reachable; Cira checks permission server-side and proxies through with a bypass
token. That is the access gateway from spec section 7, without building one.
The implementation lands in Phase 7.

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
