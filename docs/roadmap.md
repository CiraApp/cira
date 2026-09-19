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

- [ ] **1.1 Production sign-in.** Move off Clerk's development instance
      (`pk_test`) to a production one on cira.dev.
  - _You:_ create the production instance, add its DNS records, create Google
    OAuth credentials for it.
  - _Claude:_ switch the keys in Vercel, and re-link existing users by
    verified email on their first production sign-in, since a new instance
    gives everyone a new Clerk id and `users.external_id` is keyed on it.
  - Done when you can sign in on production keys and land in Paradym with
    every app and grant intact.
- [ ] **1.2 Resource limits and quotas.** Today one runaway app can exhaust
      the shared Google project and the bill has no ceiling.
  - Per app: maximum instances, CPU, memory and request timeout on the Cloud
    Run service.
  - Per space: a cap on apps and on deploys per hour.
  - Rate limits on the MCP endpoint and the console, as Ask Cira has.
  - Done when each limit is enforced, tested, and shown on the page it
    affects.
- [ ] **1.3 Watch Cira itself.** Error tracking (Sentry) for the web app,
      server and browser; an uptime check on cira.dev and the app proxy;
      alerts to you. Confirm Neon's point-in-time restore is on and has been
      tried once. Done when a thrown error and a downtime each reach you.
      _You create the accounts, Claude wires them._
- [ ] **1.4 A record of who ran what.** Every invocation, from MCP, Ask Cira
      or the console: who, which capability, which app, when, and the status,
      but never the input or the reply, which keeps Cira a conduit. Shown to
      whoever manages the app. Additive migration. Done when a refund run from
      the console appears on the app page with the person's name.
- [ ] **1.5 Email.** A transactional provider (Resend) for invites, which
      today are links the inviter sends by hand. Done when an invite arrives
      by email and can be accepted from it. _You create the account and verify
      the domain, Claude builds._
- [ ] **1.6 Scheduled jobs.** Work that runs on a timer - a nightly sync, a
      Monday report - on Cloud Run Jobs and Cloud Scheduler. How a schedule is
      declared, a page to see and change it, run history through the runtime
      logs page, and a failed run treated as a failure. Design doc first.
      Done when a script that runs and exits deploys, runs on its schedule,
      and its runs and their logs are visible.
- [ ] **1.7 Notifications.** Email when a deploy fails, an app stops
      answering, a scheduled run fails, or a capability becomes refused.
      Depends on 1.5 and 1.6. Done when each of those four reaches whoever
      manages the app.

## Phase 2 - Ready to charge

Exit when a company can pay, knows what it is agreeing to, and is billed for
what it uses.

- [ ] **2.1 Pricing.** What a plan includes and costs, in terms of the limits
      from 1.2. _You decide; Claude writes it into the product._
- [ ] **2.2 Billing.** Stripe checkout and customer portal, plans enforced
      through the limits from 1.2, and what happens when a payment fails.
      Depends on 2.1. _You create the Stripe account._
- [ ] **2.3 Usage and cost per company.** Label every Cloud Run service with
      its space, export Google billing, and show each company what it used.
      Needed to price sensibly and to spot a customer who costs more than
      they pay.
- [ ] **2.4 Legal.** Terms of service, privacy policy, a data processing
      agreement, a list of subprocessors (Google, Vercel, Neon, Clerk,
      Anthropic, Cloudflare), and a security page. _You, with a lawyer or a
      reputable template; Claude publishes them._
- [ ] **2.5 Leaving and deleting.** A company can export what Cira holds
      about it and delete its space, which tears down its apps, services and
      data. Required by the privacy policy.
- [ ] **2.6 Front door.** A marketing site with pricing, and public docs for
      the CLI, MCP and the console.
- [ ] **2.7 Apps with their own sign-in.** Today their capabilities show as
      refused. Calling them on behalf of the signed-in person is the largest
      unlock for real internal tools, and it deliberately changes the
      headers allow-list in `invoke-capability.ts`. Design doc and a security
      review first.
- [ ] **2.8 Faster first request.** Apps scale to zero, so the first request
      after a quiet spell waits. A minimum-instances option, as a paid
      feature, since it costs money every hour.

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
