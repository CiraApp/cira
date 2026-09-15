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
- [x] Invite by link bound to one address, join through it
- [x] Join by company email domain, so colleagues do not need inviting one by one
- [x] Logout

## Phase 3 - App gallery

- [x] Responsive card grid, icon + name + secondary label only
- [x] Search apps
- [x] Clicking a card opens the app page; Open launches the deployment

## Phase 4 - Apps + permissions

- [x] App records scoped to a space
- [x] Gallery reflects access rules exactly, verified end to end against a
      real database: a member sees only granted apps, and an ungranted app or
      a space they do not belong to returns 404 rather than 403
- [x] Grant and revoke access from the UI, picking from space members only

## Phase 5 - CLI authentication

- [x] `cira login` by device code, plus `logout`, `whoami`, `status`
- [x] Token storage in ~/.cira/config.json, 0600, hashed server-side
- [x] `.cira/project.json` local project metadata (read/write + framework detection)

## Phase 6 - DeploymentProvider abstraction

- [x] Provider selection in one place, failing loudly when unconfigured
- [x] Status and log plumbing, with provider states mapped into Cira's

## Phase 7 - Actual provider deployment

- [x] Provider chosen: Vercel
- [x] Implemented behind `DeploymentProvider` (`packages/deploy/src/vercel.ts`)
- [x] Wire the CI deploy step (for Cira itself)
- [x] Deploys point at the existing team, on the captain's explicit call. The
      separate-team argument still stands and is a launch-time item: this code
      path creates and deletes projects.

## Phase 8 - `cira deploy` end to end

- [x] Detect project, validate Next.js
- [x] Package and upload source, content-addressed
- [x] Deploy, create/update the App record, return the URL
- [x] A new app is visible to its deployer only; widening is deliberate
- [x] First real deploy against a live provider, end to end

## Phase 9 - App management + logs

- [x] Deploy history on the app page, with build logs per deploy
- [x] Status reconciled where it is read, so nothing spins forever
- [x] Rename and delete an app

## Phase 10 - Polish + end-to-end tests

- [x] `create space → invite → create app → grant access → member sees app`,
      run against a real Postgres in CI
- [x] `deploy → app available → employee opens it`, verified by hand against a
      live provider; the permission half is covered by the journey tests
- [x] No horizontal overflow and no small touch targets at 390, 768 and 1280
- [x] The whole journey walked by hand on production: deploy from the CLI,
      grant an employee access, watch it appear in their gallery, open it, and
      confirm an app they were not given still bounces them back
- [ ] That journey as an automated browser test (needs a stable way to drive a
      real sign-in without the provider's bot check)

## Decisions made

- **Host** - Vercel, in the "aumit shiv" Pro team, which
  also holds wave. Pro allows commercial use, so the Hobby licensing limit
  below no longer applies while Cira lives here. Live at
  https://cira-aumitshiv.vercel.app (behind the team's Deployment Protection).
  Reference the team by id, never by slug: the slug has already changed once
  and every URL built from it rots silently.
- **Deploys** - driven from GitHub Actions, gated on the verify job. Vercel's
  Git integration is deliberately NOT connected: it builds on every push
  regardless of CI, so a red pipeline would still ship. `VERCEL_TOKEN` is a
  repository secret and expires 2026-12-14; org and project ids are not
  secrets and live in the workflow.
- **Joining** - a company is the unit, like Slack: a space claims its
  founder's email domain, and anyone with a VERIFIED address there joins in one
  click without an invite. Public providers (gmail and friends) can never be
  claimed. This exists because the second employee to sign up was otherwise
  pushed to found a duplicate of their own company.
- **Shell, not a page.** A fixed spine on the left holds navigation and the
  space switcher, a thin header carries what belongs to the current view, and
  one column scrolls. Navigation lives in exactly one place.
- **Architectural, not soft.** A 3px cut edge everywhere, hairline borders
  doing the separating, and depth spent only where something is genuinely
  lifted. No pills, no bubbles.
- **The apps bring the colour, the chrome does not.** Every app carries its
  own hue; the interface stays near-monochrome and spends its one accent on the
  single primary action and on focus. Most software of this kind paints its
  brand over everything, which is exactly how an app library starts feeling
  like an infrastructure console. Neutrals are cool and biased toward the
  accent so they read as chosen rather than inherited.
- **Dark is designed, not inverted.** The ground is a blue-black in the same
  family as the accent, surfaces lift by getting lighter rather than by shadow,
  and every app hue has a separate dark rendering because a wash that glows on
  paper goes muddy on a dark ground.
- **One vocabulary, enforced.** The shell rebuild introduced a new token set and
  left most of the product spelling the old one, so every screen outside the
  gallery was asking for colours, radii and shadows that no longer existed and
  silently rendering with none of them. Buttons and fields are now single
  classes in `@layer components` rather than utility strings copied between
  call sites: the layer matters, because a component class written outside it
  beats the utility meant to override it, which is how a padding utility on a
  field stops working.
- **Onboarding is one card with three states**, not a wizard: join the company
  that is already here, name a new one, or the moment that says it worked.
  Which one opens is decided by the email domain rather than by asking, because
  being asked a question the system can already answer is the setup step this
  screen exists to avoid. The slug preview under the field is the only thing
  there that is not strictly required: it shows what a space _is_ - a place
  with an address - without a sentence explaining it, and it runs the same
  `slugify` the server will, so it cannot promise an address the server would
  refuse. Onboarding, an invite and the CLI hand-off now share one frame, so
  the three screens someone meets before they have a space cannot drift apart.
- **Two colours decide the interface, and there is no light/dark switch.**
  A base and an accent are the only inputs; panels, hairlines and three weights
  of ink are all mixed from them in CSS, so any pair a person chooses produces
  a coherent palette rather than a broken one. The mode is not a preference
  either - it is read off the base, because a colour either can carry pale text
  or it cannot, and asking someone to tell us which after they have just shown
  us is the sort of question this product does not ask. Black or white is
  picked by whichever has more contrast rather than by a luminance threshold: a
  threshold gets the shipped accent wrong, since #5b85ff sits below the usual
  midpoint and still takes dark text. The cost is that the two hand-tuned
  palettes are now derived rather than hand-written, so a few tokens land a
  shade off where they used to.
- **The colour choice is personal and local**, stored in the browser next to
  where the light/dark choice used to live. It is a preference, not company
  branding: nothing reaches the server, no column was added, and a browser that
  refuses storage still renders correctly - it just does not remember. An
  inline script stamps the colours before first paint, so nobody watches a dark
  interface load as a white one.
- **The colour wheel is in the panel, not in an operating-system window.**
  `<input type="color">` opens a dialog in the corner of the screen with its
  own typeface and its own corners, and it covers the very thing you are trying
  to judge. The wheel replaces it: angle is hue and distance from the middle is
  saturation, which is what lets a wheel be read without a legend, and
  lightness gets a track underneath because it is the one axis a wheel cannot
  show. Choosing happens over the live interface, because the only useful
  preview of an interface is the interface. The hex field stays alongside it -
  dragging to find a colour and pasting one the brand already has are different
  tasks.
- **Bad contrast is shown, not prevented.** Someone choosing their own colours
  is allowed to choose badly, but the picker says so when the accent drops
  below the 3:1 WCAG floor against the base. Refusing the colour would be
  worse: it is their interface.
- **The ground is lit, not flat.** An aurora of the accent drifts behind the
  page on a minute-long cycle, a constellation moves in depth above it, and two
  per cent of grain sits over everything. Near-black with nothing happening in
  it reads as a screen that is off; this is what makes it read as a room. All
  three are decoration and the product is complete without any of them.
- **The pointer lights things, rather than selecting them.** A card's border and
  the wash beneath it brighten where the cursor is, in that app's own hue,
  painted by a gradient masked into a one-pixel ring. The position is written
  straight onto the element as a CSS variable, never through React state: it
  updates every frame of every hover and must not re-render anything.
- **Motion that is about position.** The sidebar's rail and panel are single
  elements that slide between rows, measured from live geometry rather than
  assumed, because a sidebar marks where you are in a structure; five lights
  switching on and off does not. Cards resolve out of the ground on arrival,
  the header's title re-enters when the route changes, and a deploy in flight
  sends out a ring instead of blinking.
- **The route bar waits before it appears.** Almost every navigation is
  prefetched and lands in a frame, so the bar holds for 180ms and never shows
  for those. A progress bar that flashes on every click is what makes an app
  feel busy rather than quick.
- **⌘K is a launcher, not a filter.** Cira is a front door before it is a
  console, so the fastest path to an app does not require first being on the
  page that lists them. The index is fetched on first open and matched as a
  subsequence, so "rvd" finds Revenue Dashboard; the gallery keeps "/" for its
  own in-page search, and there is exactly one global shortcut.
- **Overlays are portalled, not nested.** The header applies a backdrop filter,
  and a filtered element becomes the containing block for every `position:
fixed` descendant. Anything full-screen opened from the chrome - the palette,
  the invite dialog, the phone's nav sheet - was therefore clipped to the header
  box. It presents as a backdrop that dims only the top bar and a panel centred
  on the wrong thing, which looks exactly like a z-index problem and is not one.
- **Hover states are gated on `(hover: hover)`**, including the hand-written
  ones, matching what Tailwind does to its own hover utilities. Ungated, a tap
  on a touch screen leaves a card lit with the rest of its hover state
  correctly doing nothing. This is invisible in a headless browser, which
  reports no hover at all and so renders none of it.
- **Tests run against a real Postgres**, not a fake. The constraints are the
  safety here, so a fake would pass while the real schema rejected the same
  write. They skip rather than fail when no database is offered, so `pnpm test`
  still works on a laptop with nothing running.
- **Status is reconciled where it is read**, not by a background job. A page
  view re-checks an in-flight deploy against the provider, and a gallery cheaply
  settles deploys too old to still be running without any network call. The
  moment someone is looking is exactly when the answer has to be true, and it
  avoids polling for something nobody is watching.
- **CLI sign-in** - a device code, not a local callback server, so it behaves
  the same over SSH and in a container. The CLI holds the secret device code
  and polls; the person only ever sees a short code, so one read aloud or
  pasted into chat cannot be exchanged for a token. Tokens are stored only as
  a SHA-256 hash, making "show it to me again" impossible by construction.
- **Invites** - a link the inviter sends themselves, bound to one email
  address, single use, seven-day lifetime. No mail provider in V1: an inviter
  who can reach a colleague already has a channel, and binding to an address
  stops a forwarded link letting a stranger into an internal space.
- **Superseded** - the original plan was the personal Hobby account. No paid plan is
  needed for any phase below. Vercel Authentication can protect production
  domains for free on Hobby as of 2026-09-09 (it previously needed a
  $150/month add-on), so the access gateway works without paying.
  Pro becomes necessary when Cira stops being a dev project: a real company
  using it, charging anyone, or adding a second collaborator (Hobby is
  single-user). That is a launch concern, not a build concern.
- **Deployment provider** - Vercel API first, behind `DeploymentProvider`.
  Chosen because V1 targets Next.js only, which is exactly what Vercel is best
  at, and it adds no new billing relationship.
- **Database** - Neon Postgres, provisioned directly rather than through the
  Vercel marketplace, so it is tied to neither a team nor a plan.
- **ORM** - Drizzle. Lighter cold starts than Prisma on serverless, and its
  inference holds up under our strict compiler settings.
- **Auth** - Clerk, for identity only. Auth.js v5 is still beta and auth is what
  gates access to company software. Clerk sits behind `lib/identity.ts`, the one
  module that imports it, so it stays swappable. Cira still owns Space,
  Membership and AppAccess in its own tables.
- **App gateway** - built and working. A deployed app has protection on every
  URL, so it is unreachable to everyone, and Cira holds the only key. Opening
  an app goes through Cira, which checks permission and then redirects with a
  one-time parameter the provider exchanges for a cookie. Employees never need
  an account with whoever runs the app.
  The weak point, deliberately accepted for V1: the key is briefly visible in
  the address bar, and is stored unencrypted. A full proxy would avoid both, at
  the cost of standing between every request and the app. Worth revisiting
  before real customer data lives behind it.

## Still open

- Whether redeploys should reuse one Vercel project per Cira app (assumed yes).
- Invite delivery: Clerk invitations vs. our own emails through Resend.
- At Phase 7, whether deployed customer apps belong in a separate Vercel team
  from Cira itself, so the deploy path that can delete projects cannot reach
  Cira's own deployment. Costs a paid team; decide with real deploy code in
  front of us.
