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
  - [ ] A downtime reaching you, end to end: not yet seen, since nothing has
        been down. A drill (pointing the monitor at a failing address for a
        few minutes) is yours to allow.
- [x] **1.4 A record of who ran what.** `invocations`, written by the one
      path every surface shares, shown under Capability runs on each app page to whoever
      manages it; never the input or the reply (2026-09-19).
- [ ] **1.5 Email.** Resend, sending as `notifications@cira.dev` (domain
      verified 2026-09-19, records in Cloudflare). Invitations are emailed
      when created, with the link still shown. Done when an invite arrives by
      email and is accepted from it - one real invite is all that is left.
- [x] **1.6 Scheduled jobs and workers.** Found in a repository's Procfile,
      fly.toml or scheduled GitHub Actions workflows; scheduled runs on Cloud
      Run Jobs started by Cloud Scheduler, workers on Cloud Run worker pools;
      switched on, timed and run from the app page. Verified end to end with
      `fixtures/background-app` on 2026-09-19.
- [ ] **1.7 Notifications.** Built: an app's managers are emailed when a
      deploy fails, it stops answering (two checks in a row) or comes back, a
      worker keeps stopping, a scheduled run fails, or a working capability
      starts refusing Cira. Each event is claimed once in `notifications`; the
      watcher runs every five minutes on Vercel Cron. Every path is tested,
      and a sample reached the inbox. Done when a real one of each reaches a
      manager, which happens as they occur.

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
  - [ ] _You:_ switch Stripe to live mode when there is a customer: create the
        same two prices with the lookup keys `cira_team_seat` and
        `cira_team_worker`, a live webhook to `/api/stripe/webhook`, and
        replace the two Vercel secrets.
- [x] **2.3 Usage and cost per company.** Cloud Monitoring is asked what each
      service, job and worker pool ran for, attributed to apps by Cira's own
      records, priced by `pricing.ts`, and shown to admins at
      `/{space}/~/usage` with deploys, capability runs and questions asked
      (2026-09-19). Measured against the real project: under a dollar a month
      so far, all of it Wave.
- [ ] **2.4 Legal.** Terms of service, privacy policy, a data processing
      agreement, a list of subprocessors (Google, Vercel, Neon, Clerk,
      Anthropic, Cloudflare), and a security page. _You, with a lawyer or a
      reputable template; Claude publishes them._
- [x] **2.5 Leaving and deleting.** Any admin can export everything Cira
      holds about their company as one JSON file (never a variable's value);
      an owner can delete the space with its name typed back, which tells
      Google app by app before forgetting anything and refuses while a
      subscription is still running (2026-09-20).
- [ ] **2.6 Front door.** A marketing site with pricing, and public docs for
      the CLI, MCP and the console.
- [ ] **2.7 Apps with their own sign-in.** Today their capabilities show as
      refused. Calling them on behalf of the signed-in person is the largest
      unlock for real internal tools, and it deliberately changes the
      headers allow-list in `invoke-capability.ts`. Design doc and a security
      review first.
- [x] **2.8 Faster first request.** An app's managers can keep one instance
      running from its settings, on a paid plan, billed as its own line at $75
      a month against about $50 of cost. It survives deploys (2026-09-20).

## Phase 3 - Larger companies

- [ ] **3.1 Enterprise sign-in.** SAML SSO and SCIM provisioning, through
      Clerk's enterprise features.
- [ ] **3.2 A Google project per company.** Real isolation of compute,
      quotas, logs and bills, instead of one shared project and one service
      account that can reach every app.
- [ ] **3.3 SOC 2.** Through a compliance platform (Vanta or Drata). _You._
- [ ] **3.4 Databases and caches.** Provision through providers such as Neon
      and Upstash rather than hosting data, which keeps Cira out of the
      business of holding customers' data.
- [ ] **3.5 Custom domains** for apps.
- [ ] **3.6 Penetration test** of the app proxy, sessions and MCP, by an
      outside firm. _You._

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
