# Cira implementation checklist

Build in vertical slices. After every phase: `pnpm typecheck && pnpm lint && pnpm test`.
Keep `prod` green.

## Phase 1 - Project structure + auth + DB

- [x] pnpm monorepo, strict TypeScript, ESLint, Prettier, Vitest
- [x] Domain model (`User`, `Space`, `Membership`, `App`, `AppAccess`, `Deployment`)
- [x] Permission logic with unit tests
- [x] `DeploymentProvider` interface
- [x] CI on push to `prod`: typecheck, lint, format, build, test
- [ ] Next.js app in `apps/web`
- [ ] PostgreSQL schema + migrations in `packages/db`
- [ ] Authentication and session handling
- [ ] Wire permission checks into a server-side authorization helper

## Phase 2 - Spaces + memberships + invites

- [ ] Create a Space (first-login onboarding, one field, no wizard)
- [ ] Space membership and roles
- [ ] Invite by email, join through invite link
- [ ] Logout

## Phase 3 - App gallery

- [ ] Responsive card grid, icon + name + secondary label only
- [ ] Search apps
- [ ] Clicking a card opens the deployed app

## Phase 4 - Apps + permissions

- [ ] App records scoped to a space
- [ ] Grant and revoke access (`user`, `space`)
- [ ] Gallery reflects access rules exactly

## Phase 5 - CLI authentication

- [ ] `cira login`
- [ ] Token storage
- [ ] `.cira/project.json` local project metadata

## Phase 6 - DeploymentProvider abstraction

- [ ] Provider registry and selection
- [ ] Status and log plumbing

## Phase 7 - Actual provider deployment

- [ ] Choose the provider (open decision)
- [ ] Implement it behind `DeploymentProvider`
- [ ] Wire the CI deploy step

## Phase 8 - `cira deploy` end to end

- [ ] Detect project, validate Next.js
- [ ] Package and upload source
- [ ] Deploy, create/update the App record, return the URL
- [ ] Prompt for access on first deploy; redeploy in place afterwards

## Phase 9 - App management + logs

- [ ] Manage view: Overview, Access, Deployments, Settings
- [ ] Deployment status and basic build logs

## Phase 10 - Polish + end-to-end tests

- [ ] `create space → invite → create app → grant access → member sees app`
- [ ] `deploy → app available → employee opens it`
- [ ] UI polish against the quality bar in spec section 16

## Open decisions

- **Deployment provider** - spec suggests Railway or similar. Not chosen.
- **Auth** - Clerk, Auth.js, or similar. Not chosen.
- **ORM** - Drizzle or Prisma. Not chosen.
- **App gateway** - whether deployed apps sit behind a Cira auth proxy in V1
  (spec section 7 says "if possible").
