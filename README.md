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
  web/        Next.js app - employee gallery and app management
packages/
  core/       Domain model, permission logic, deployment provider interface
  db/         PostgreSQL schema and migrations
  deploy/     Deployment provider implementations
  cli/        The `cira` command
  ui/         Shared UI components
```

`packages/core` holds no framework and no provider code. Permission checks take
explicit records and are always run server-side - client-supplied space and user
ids are never trusted.

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev          # run the web app
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Shipping

`prod` is the production branch. Push to `prod` and CI runs typecheck, lint,
format, build and tests; a green run deploys. There are no pull requests and no
preview environments by design - see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Deployment providers

Cira does not own compute. Everything routes through the `DeploymentProvider`
interface in `packages/core`, so the provider can be replaced without touching
anything above it. No provider is wired up yet.
