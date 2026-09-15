# Cira implementation checklist

Build in vertical slices. After every phase: `pnpm typecheck && pnpm lint && pnpm test`.
Keep `prod` green.

## Phase 1 - Project structure + auth + DB

- [x] pnpm monorepo, strict TypeScript, ESLint, Prettier, Vitest
- [x] Domain model (`User`, `Space`, `Membership`, `App`, `AppAccess`, `Deployment`)
- [x] Permission logic with unit tests
- [x] `DeploymentProvider` interface
- [x] CI on push to `prod`: typecheck, lint, format, build, test
- [x] Next.js app in `apps/web` (Next 16, React 19, Tailwind v4)
- [x] PostgreSQL schema + migrations in `packages/db` (Drizzle + Neon)
- [x] Authentication and session handling (Clerk, behind an identity seam)
- [x] Wire permission checks into a server-side authorization helper

## Phase 2 - Spaces + memberships + invites

- [x] Create a Space (first-login onboarding, one field, no wizard)
- [x] Space membership and roles
- [ ] Invite by email, join through invite link
- [ ] Logout

## Phase 3 - App gallery

- [x] Responsive card grid, icon + name + secondary label only
- [x] Search apps
- [x] Clicking a card opens the app page; Open launches the deployment

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

## Decisions made

- **Host** - Vercel.
- **Deployment provider** - Vercel API first, behind `DeploymentProvider`.
  Chosen because V1 targets Next.js only, which is exactly what Vercel is best
  at, and it adds no new billing relationship.
- **Database** - Neon Postgres, via the Vercel integration.
- **ORM** - Drizzle. Lighter cold starts than Prisma on serverless, and its
  inference holds up under our strict compiler settings.
- **Auth** - Clerk, for identity only. Auth.js v5 is still beta and auth is what
  gates access to company software. Clerk sits behind `lib/identity.ts`, the one
  module that imports it, so it stays swappable. Cira still owns Space,
  Membership and AppAccess in its own tables.
- **App gateway** - Vercel Deployment Protection plus a bypass token, proxied
  through Cira. Deployed apps are unreachable on their raw URL; Cira checks
  permission server-side and then proxies. This satisfies spec section 7
  without building a gateway.

## Still open

- Whether redeploys should reuse one Vercel project per Cira app (assumed yes).
- Invite delivery: Clerk invitations vs. our own emails through Resend.
