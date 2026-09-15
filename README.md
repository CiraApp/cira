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

## Publishing the CLI

```sh
pnpm --filter @cira/cli build   # tsc, then bundle into bin/cira.js
cd packages/cli && npm publish
```

`@cira/cli` ships as a single self-contained file with **no runtime
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
