# Roadmap: from working product to customers

What stands between Cira today and companies paying for it, in the order it
should be done. This is the answer to "what's next": the next step is the
first unchecked item whose dependencies are done.

Each item says what "done" means, so it is clear when to tick it, and who has
to act. **You** means something only the founder can do - an account, a
decision, a signature. **Claude** means code, tests and docs in this repo.

Tick an item in the same commit that finishes it. Add new items where they
belong in the order rather than at the bottom.

---

## Phase 0 - Housekeeping

Small things already known to be outstanding.

- [x] **Promote CLI 0.5.1 on npm.** Promoted 2026-09-19. _You._
- [x] ~~**Rotate the Upstash token for Wave's test Redis.**~~ Not doing:
      decided 2026-09-19 that the test Redis does not warrant it.
- [x] **Confirm runtime logs work in production.** Logs Viewer granted and
      reads succeeding on 2026-09-19.
- [x] **Store no credential as itself.** `apps.access_secret` erased and
      dropped; invite links and `cira login` device codes kept only as
      SHA-256 hashes, like CLI tokens (2026-09-19).

## Phase 1 - Safe to let a design partner in, for free

Exit when a company Cira has never met can sign up, invite its team, deploy,
use its apps, and Cira would know if anything broke for them.

- [x] **1.1 Production sign-in.** Live on Clerk's production instance at
      clerk.cira.dev since 2026-09-19. Existing people are re-linked to their
      Cira account by verified email on first sign-in (`lib/identity.ts`).
      Sign-in is by email code, as it was in development.
  - [ ] _You:_ replace the production secret key, which passed through a chat
        while being set up: create a new one in Clerk, paste it into Vercel's
        Production `CLERK_SECRET_KEY`, run `gh workflow run ci --ref prod`,
        then delete the old key. Optional.
  - [ ] Sign in with Google, if wanted: custom OAuth credentials in Clerk's
        SSO connections. Not needed for parity; development never had it.
- [x] **1.2 Resource limits and quotas.** One record in core
      (`limits.ts`): 25 apps and 30 deploys an hour per space, 60 runs a
      minute per person, and each app up to 10 instances of 1 CPU and 512 MB
      with a five-minute request timeout. Enforced, tested, and shown on the
      Deploy page and each app page (2026-09-19).
- [x] **1.3 Watch Cira itself.** Errors from the server and the browser go to
      Sentry (`cira-web`), scrubbed of anything a request carried; a thrown
      error reached Sentry from a production build and through cira.dev's
      relay on 2026-09-19. One Sentry uptime monitor checks `/api/health`
      every minute - the app, its database and the app proxy together, since
      the free plan has one monitor - and a workflow emails the `cira` team
      when it opens a downtime issue. Neon restore: not tried, your call.
  - [ ] _You:_ create an organization token named `cira-ci` in Sentry
        (Settings, Organization Tokens; the API will not make one) and store
        it with `gh secret set SENTRY_AUTH_TOKEN --repo CiraApp/cira`, so
        stack traces show Cira's source rather than minified code.
  - [x] A downtime reaching you, end to end: drilled 2026-09-23, alert
        received three minutes in (roadmap 4.7).
- [x] **1.4 A record of who ran what.** `invocations`, written by the one
      path every surface shares, shown under Capability runs on each app page to whoever
      manages it; never the input or the reply (2026-09-19).
- [x] **1.5 Email.** Resend, sending as `notifications@cira.dev` (domain
      verified 2026-09-19, records in Cloudflare). Invitations are emailed
      when created, with the link still shown. A real invite was accepted from
      its email on 2026-09-22; someone joining without a name is now asked for
      one on the invite page.
- [x] **1.6 Scheduled jobs and workers.** Found in a repository's Procfile,
      fly.toml or scheduled GitHub Actions workflows; scheduled runs on Cloud
      Run Jobs started by Cloud Scheduler, workers on Cloud Run worker pools;
      switched on, timed and run from the app page. Verified end to end with
      `fixtures/background-app` on 2026-09-19.
- [x] **1.7 Notifications.** An app's managers are emailed when a deploy
      fails, it stops answering (two checks in a row) or comes back, a worker
      keeps stopping, a scheduled run fails, or a working capability starts
      refusing Cira. Each event is claimed once in `notifications`; the watcher
      runs every five minutes on Vercel Cron. A real one of each reached the
      inbox on 2026-09-22, from `crash-e2e` and `notify-e2e` on production; the
      page and `app_status` now say the same things the emails do.

## Phase 2 - Ready to charge

Exit when a company can pay, knows what it is agreeing to, and is billed for
what it uses.

- [x] **2.1 Pricing.** Placeholders in core's `plans.ts`, set from measured
      costs (2.3): Trial, free for 14 days with one worker; Team, $12 per
      person a month with five minimum, plus $75 a month for each worker -
      above the ~$52 a worker costs. A space's plan is a column, read where
      limits are enforced. Revisit with a real customer in front of you.
- [x] **2.2 Billing.** Stripe checkout and billing portal, hosted by Stripe so
      Cira never sees a card; subscriptions applied by signed webhook, plans
      enforced through 1.2's limits, seats and workers kept in step by the
      watcher. A failed payment warns and changes nothing; a cancelled one
      falls back to a trial's allowance (2026-09-19). In test mode.
  - [x] Live since 2026-09-22: `STRIPE_SECRET_KEY` is the live key, and Cira
        made the live product, its three prices and the webhook itself on the
        next watcher pass. Paradym's test-mode subscription is forgotten by
        the same code that handles one deleted in Stripe.
  - [ ] _You:_ Stripe still wants bank details (`external_account`) before it
        pays out. Charges work without them.
- [x] **2.3 Usage and cost per company.** Cloud Monitoring is asked what each
      service, job and worker pool ran for, attributed to apps by Cira's own
      records, priced by `pricing.ts`, and shown to admins at
      `/{space}/~/usage` with deploys, capability runs and questions asked
      (2026-09-19). Measured against the real project: under a dollar a month
      so far, all of it Wave.
- [x] **2.4 Legal.** Terms, privacy, subprocessors and a security page are
      published at `/legal/*`, written to describe what Cira actually does -
      including what it does not hold and what is not built. They carry a
      visible notice that they are drafts (2026-09-20).
  - [ ] _You:_ have terms and privacy reviewed by a lawyer before taking
        money from a customer outside your own company, and decide the legal
        entity and governing law they name. A data processing agreement is
        offered by email rather than published; a template needs choosing.
- [x] **2.5 Leaving and deleting.** Any admin can export everything Cira
      holds about their company as one JSON file (never a variable's value);
      an owner can delete the space with its name typed back, which tells
      Google app by app before forgetting anything and refuses while a
      subscription is still running (2026-09-20).
- [x] **2.6 Front door.** A public landing page, pricing read from the same
      record the product enforces, and docs covering deploying, opening apps
      and pointing an assistant at them, all at cira.dev while signed out
      (2026-09-20).
- [x] **2.7 Apps with their own sign-in.** Cira signs a sixty-second
      assertion naming the person behind a call, bound to the app's own
      origin; apps verify it against `/.well-known/cira-jwks.json`. Off per
      app until its managers turn it on, which also clears the refusals
      collected while Cira called as nobody. Design and the answers to its
      security questions: `docs/apps-with-their-own-sign-in.md` (2026-09-20).
- [x] **2.8 Faster first request.** An app's managers can keep one instance
      running from its settings, on a paid plan, billed as its own line at $75
      a month against about $50 of cost. It survives deploys (2026-09-20).

## Phase 3 - Larger companies

- [x] **3.1 Enterprise sign-in.** SAML single sign-on through Clerk's
      enterprise connections, set up by a space's admin from Settings: Cira
      makes the connection for the company's domain, shows what the identity
      provider needs, and turns it on with the provider's metadata. SCIM 2.0 is
      Cira's own (`/api/scim/v2`, a bearer token per space): people are added
      as assigned, removed and kept out when deactivated, and groups are kept
      as teams, so access follows them. Okta's and Entra's dialects are both
      tested (2026-09-22).
  - [ ] _You:_ single sign-on in production needs Clerk's Pro plan (the first
        connection is included). Until then an admin who tries is told so;
        SCIM works on any plan. Verified against Clerk's development instance.
- [ ] **3.2 A Google project per company.** Real isolation of compute,
      quotas, logs and bills, instead of one shared project and one service
      account that can reach every app.
- [ ] **3.3 SOC 2.** Not pursued for now (your call, 2026-09-22): the readiness
      work - controls mapped to what Cira does - is in `docs/soc2-readiness.md`.
- [ ] **3.4 Databases and caches.** Provision through providers such as Neon
      and Upstash rather than hosting data, which keeps Cira out of the
      business of holding customers' data.
  - [x] Postgres: `cira deploy --database`, or yes to the offer when the code
        reads a `DATABASE_URL` nobody set, makes the app its own Neon project in
        Cira's Neon organisation and sets `DATABASE_URL` (pooled) and
        `DATABASE_URL_UNPOOLED` for the app, its workers, runs and release
        command. `cira database url` prints the address; removing the app
        deletes the database (2026-09-22).
  - [ ] _You:_ Neon's free plan caps how many projects the organisation holds
        and how big each is. Move the Cira organisation to a paid plan before
        a customer depends on it.
  - [x] Caches: `cira deploy --cache`, or yes to the offer for a `REDIS_URL`
        nobody set, makes the app its own Upstash Redis on Google Cloud in the
        apps' region and sets it; `cira cache url`; deleted with the app
        (2026-09-22). Verified end to end on production: a counter app
        incremented across runs, `cira cache url` read the same cache, and
        removing the app deleted it.
  - [x] Cira's Upstash account (akirtania17@gmail.com) and its key are in
        Vercel (2026-09-22).
  - [ ] _You:_ add a payment method in Upstash before a second app needs a
        cache. The free plan allows one database per account (`wave-test` was
        deleted on your say-so to free it); a deploy past that is told the
        plan is full. Pay as you go is billed per request.
- [x] **3.5 Custom domains** for apps. A manager adds `tools.acme.com` on the
      app page; Cira makes it a Cloudflare custom hostname, shows the CNAME to
      make, and the app proxy serves it once the certificate is issued, behind
      the same sign-in (2026-09-22). Verified end to end on production with
      `probe.acmetest.app`: certificate in about two minutes, opened through
      Cira's sign-in, refused without a session, removed cleanly.
- [ ] **3.6 Penetration test** of the app proxy, sessions and MCP, by an
      outside firm. _You._ An internal test came first (2026-09-23,
      `docs/pentest-2026-09.md`): no critical or high findings; SCIM reach,
      forged Cira headers through the proxy and the audience guidance were
      fixed and re-tested on production. It ends with where the firm's time is
      best spent.

## Phase 4 - Release readiness

The things a company would notice missing the first week it ran on Cira, found
by asking what Cira could not answer for after something went wrong.

- [x] **4.1 Rollback and redeploy.** A manager puts an app back on any build it
      ran before, from that deploy under Deploys: nothing is rebuilt, the
      variables, warmth and memory stay as they are, and its workers and
      scheduled runs move with the web traffic. A release command never runs
      again on the way back, and a rollback past one says plainly that the
      database does not go back with the code. The newest deploy offers the
      same as "Deploy this version again" (2026-09-23). Verified on production
      on a web app and a worker-only app; the web app answered afterwards.
- [x] **4.2 A record of who changed what.** Roles, removals, joins,
      invitations, teams, app access, capability switches, telling an app who
      is calling, addresses, single sign-on, directory sync, rollbacks, deleted
      apps, the company name and joining by domain, written by the actions
      themselves and read by admins at `/<space>/~/changes`. Append-only, in
      the words rather than the ids, and holding no token, variable or input
      (2026-09-23). The other half of 1.4.
- [x] **4.3 Dependency updates.** Dependabot raises one grouped pull request a
      week for npm and one a month for actions, with security fixes on their
      own (2026-09-23).
- [x] **4.4 Teams people actually land on.** An invitation carries the teams
      someone joins, said in the email and applied the moment they accept; each
      person's row on Members opens their teams to tick, so the roster can be
      kept from either side (2026-09-23).
- [x] **4.5 A restore drill.** Cira's database restored to a moment 49
      minutes back, on a new branch: answering in 2.6 seconds, verified in 6.5,
      right to the row (2026-09-23). `scripts/restore-drill.mjs` repeats it;
      `docs/restore.md` is the procedure for a real one. Found doing it: Neon
      keeps only 6 hours of history on the current plan, which is one more
      reason for the paid plan in 3.4.

- [x] **4.6 A stranger's first day.** A new account, made through the real
      sign-up and its human check, founded a company, invited someone who
      accepted from the email, deployed an app with the published CLI, opened
      it, was the only one who could, and deleted the company (2026-09-23).
      Found the published CLI ten changes behind (0.7.0 released the same day), and two rough
      edges in onboarding, both fixed.
- [x] **4.7 Downtime reaching you.** Drilled 2026-09-23: `/api/health` failed
      from 06:34 to 06:55 UTC and recovered on its own, and Sentry's downtime
      alert reached the owner's inbox at 06:37 - three minutes in. Sentry
      emails the address on its own account, which is not akirtania17@gmail.com;
      a drill can be run again with `CIRA_HEALTH_DRILL_UNTIL`.
- [x] **4.8 Accessibility.** An audit against WCAG 2.2 AA, then fixes: dialogs
      that take and return focus, contrast measured on every theme preset,
      focus rings on every control, overlays a keyboard can use, and live
      regions that say something useful (2026-09-23, A11Y-1 to 7).

---

## Done

The product as it stands, for reference.

- Deploy from any repository with the CLI, including Dockerfiles and apps
  with several parts; environment variables checked before deploying.
- Capabilities found by reading the code, confirmed against the running app,
  and published by policy: reads on, writes off until someone enables them.
- Agents over MCP with search, describe and invoke, under the same access
  rules as people.
- Ask Cira, for people who don't know what exists.
- The capability console, for people who do; API-only apps open into it.
- Runtime logs for whoever manages an app (2026-09-19).
- Names, onboarding and profile.
