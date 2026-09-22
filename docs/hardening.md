# Hardening for release

Started 2026-09-22, before the first outside company uses Cira. Five
read-only reviews traced the code the way a real business would use it
(access, people joining and leaving, deploying, capabilities and agents,
money and alerts). Every finding they reported is below. Each finding is
reproduced before it is fixed. A fix lands with a test that failed before it.

This file is the record. When a finding is fixed, its line says how and where
the test lives. When one is deliberately left alone, it says why.

**Status:**

- **open** - not yet done
- **fixed** - done, with a test
- **won't fix** - left alone on purpose, with the reason
- **partly** - the part Cira controls is done, and the rest is named
- **later** - real, but it belongs to a later roadmap item, which is named

**Severity** is how badly a company would be hurt the first time it happened:

- **critical** - lost data, secrets exposed, or someone acting where they have no right
- **high** - an outage, or money lost
- **medium** - a broken workflow
- **low** - rough edges

## Access and security

| ID     | Sev      | Finding                                                                                                                                                                                                        | Status |
| ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| SEC-1  | critical | Any member can redeploy any app in their space, including apps they cannot open, by its id (which `.cira/project.json` commits). Only setting env was checked.                                                 | fixed  |
| SEC-2  | high     | `/api/cli/capabilities` and `/verify` only check membership, so any member can rewrite or probe the capabilities of an app they cannot see.                                                                    | fixed  |
| SEC-3  | critical | The CLI uploads files `.gitignore` excludes (`.streamlit/secrets.toml`, `config/master.key`, `credentials.json`, `*.pem`, `.npmrc`), bakes them into images and sends text files to the model during analysis. | open   |
| SEC-4  | high     | CLI and assistant tokens never expire. An assistant token can deploy and remove apps.                                                                                                                          | open   |
| SEC-5  | high     | Joining by email domain has no approval and no off switch. It is on for every new space, and the list of personal-mail domains is short.                                                                       | open   |
| SEC-6  | high     | Re-linking a new sign-in by email lets whoever next holds an address inherit a former person's account, across companies.                                                                                      | open   |
| SEC-7  | medium   | The old-address redirect for a renamed app reveals the new name to people with no access.                                                                                                                      | open   |
| SEC-8  | low      | `/api/cli/source` signs 100 MB uploads for any signed-in person, with no space and no limit.                                                                                                                   | open   |
| SEC-9  | low      | `/api/cli/deploy/status` checks space membership, not access to the app.                                                                                                                                       | fixed  |
| SEC-10 | low      | `spaceMemberCount` is an exported server action with no auth check.                                                                                                                                            | fixed  |
| SEC-11 | low      | A browser session is bound to an app's address, not the app, so a new restricted app at a reused address opens for up to 15 minutes to someone who could open the old one.                                     | open   |

## People

| ID       | Sev      | Finding                                                                                                                                                     | Status |
| -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| PEOPLE-1 | critical | Nobody can be removed from a space, change role, or leave. Nothing can move an app to a new owner. There is only ever one owner.                            | open   |
| PEOPLE-2 | medium   | Pending invites cannot be listed or revoked in the product.                                                                                                 | open   |
| PEOPLE-3 | medium   | Teams cannot be created or edited in the product, so granting access to a team is impossible for a real company.                                            | open   |
| PEOPLE-4 | high     | A name can produce a slug that ends in `-` or runs past 48 characters, making a space or app that cannot be opened or deleted.                              | open   |
| PEOPLE-5 | high     | A space can take a slug that one of Cira's own routes already uses (`docs`, `pricing`, `legal`, `monitoring` and others), and then it can never be reached. | open   |
| PEOPLE-6 | low      | Names written only in non-Latin scripts are refused.                                                                                                        | open   |
| PEOPLE-7 | low      | Someone in several spaces lands in an arbitrary one.                                                                                                        | open   |
| PEOPLE-8 | medium   | Over MCP, a person in two companies sees capabilities named the same in both, with nothing saying which company each belongs to.                            | open   |
| PEOPLE-9 | low      | Double-clicking accept on an invite, or creating two spaces with the same name at once, shows a raw error.                                                  | open   |

## Deploying and running

| ID        | Sev      | Finding                                                                                                                                                        | Status |
| --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| DEPLOY-1  | critical | A redeploy with no local `.env` (a teammate's clone, or CI) wipes every production variable before the build starts.                                           | fixed  |
| DEPLOY-2  | high     | Env and process changes reach the running app before the build finishes. If the build fails they stay applied, and the email says nothing changed.             | fixed  |
| DEPLOY-3  | high     | Overlapping deploys of one app can roll production back to the older build.                                                                                    | fixed  |
| DEPLOY-4  | critical | Removing an app, or its whole space, leaves its worker pools, jobs and scheduler entries running on Google, still billing and still holding the app's secrets. | fixed  |
| DEPLOY-5  | high     | Renaming an app orphans its Cloud Run service, and the next deploy creates a second one.                                                                       | fixed  |
| DEPLOY-6  | high     | No variable reaches the build, so `NEXT_PUBLIC_*` and `VITE_*` values are missing from browser bundles.                                                        | open   |
| DEPLOY-7  | high     | The upload drops `build/`, `dist/`, `out/` and `target/`, which breaks Dockerfiles that copy from them.                                                        | open   |
| DEPLOY-8  | high     | A failed first deploy leaves a failed app behind, so every retry makes another ("My App 2" and so on).                                                         | fixed  |
| DEPLOY-9  | medium   | Only the first env file found is read, instead of the standard layering of `.env`, `.env.production`, `.env.local` and `.env.production.local`.                | open   |
| DEPLOY-10 | medium   | The CLI gives up after 10 minutes while builds may run for 20. A long build can be marked failed while its code is serving.                                    | partly |
| DEPLOY-11 | medium   | When a container fails to start, Google's reason is dropped, so the person is sent to build logs that show success.                                            | open   |
| DEPLOY-12 | medium   | A process that keeps its name but changes kind (worker to scheduled, or back) leaves the old resource running.                                                 | open   |
| DEPLOY-13 | medium   | A failed process write is swallowed. Rows are already replaced, so a worker taken out of the Procfile can keep running unseen.                                 | open   |
| DEPLOY-14 | medium   | Listing workers and jobs reads one page of 500. Past that, a running worker can be missed, and even switched off by a deploy.                                  | open   |
| DEPLOY-15 | medium   | Web apps are fixed at 512 MiB of memory, and `web` sizes in fly.toml and app.json are ignored.                                                                 | open   |
| DEPLOY-16 | medium   | The deploy route has a 60 second limit. Many processes can exceed it and leave an app stuck in "deploying".                                                    | open   |
| DEPLOY-17 | medium   | Removing `web:` from a Procfile leaves the old web service serving.                                                                                            | open   |
| DEPLOY-18 | medium   | Monorepos in the default Turborepo layout are refused, or build without their workspace packages.                                                              | open   |
| DEPLOY-19 | medium   | Static sites and SPAs with no server are deployed anyway, and then fail to build or start.                                                                     | open   |
| DEPLOY-20 | low      | A Procfile `release:` line (migrations) is dropped without telling anyone.                                                                                     | open   |
| DEPLOY-21 | low      | The dotenv parser mangles multiline values and inline comments. `--env-file=path` is ignored.                                                                  | open   |
| DEPLOY-22 | low      | `cira remove --yes` behaves differently from `cira deploy --yes`.                                                                                              | open   |
| DEPLOY-23 | low      | Status polling swallows 401 and 404 for the full wait, and the upload has no timeout.                                                                          | open   |
| DEPLOY-24 | low      | Two people switching on workers at the same moment can go past the plan's limit.                                                                               | open   |

## Capabilities and agents

| ID     | Sev    | Finding                                                                                                                                               | Status |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| CAP-1  | high   | Read or write is whatever the model says. A `DELETE` it grades as a read switches itself on and runs without approval.                                | open   |
| CAP-2  | high   | MCP writes have no approval on Cira's side. The promise that changes wait for a person holds only in Ask Cira and the console.                        | open   |
| CAP-3  | high   | A read with a path parameter (`GET /customers/{id}`) is deleted when verification's made-up id gets a "no such record" 404.                           | open   |
| CAP-4  | high   | A write that succeeds but answers with a redirect, a non-JSON body, or late is reported as unreachable. That invites a retry and a duplicate.         | open   |
| CAP-5  | high   | A capability that changes method, path or risk on redeploy stays switched on. A read can become an unreviewed write.                                  | open   |
| CAP-6  | medium | Ask Cira's daily limit can be bypassed with decision requests, and history sent from the browser is not capped.                                       | open   |
| CAP-7  | medium | A 302 to a login page, or an OPTIONS with no `Allow`, counts as callable in verification.                                                             | open   |
| CAP-8  | medium | Once headers arrive, the response body is read with no deadline, so a trickling endpoint hangs until the function is killed and no record is written. | open   |
| CAP-9  | medium | The 60-runs-a-minute limit is counted after calls finish, so parallel calls all pass.                                                                 | open   |
| CAP-10 | medium | During a build, or after a failed deploy, every capability goes dark while the old revision is still serving.                                         | open   |
| CAP-11 | medium | A write body with non-ASCII characters sends a wrong `content-length` and fails.                                                                      | open   |
| CAP-12 | medium | Ask Cira reads capabilities from every space a person is in, not only the one it was opened in.                                                       | open   |
| CAP-13 | medium | Discovery on large apps overflows the output limit and yields nothing. The source budget is filled alphabetically, so route files can be left out.    | open   |
| CAP-14 | medium | GET arrays are sent as JSON strings. Non-GET inputs all go in the body, even when the app reads them from the query.                                  | open   |
| CAP-15 | low    | A path value of `.` collapses its segment.                                                                                                            | open   |
| CAP-16 | low    | Verifying as one person records a refusal for everyone.                                                                                               | open   |
| CAP-17 | low    | A capability whose route is gone is never demoted.                                                                                                    | open   |
| CAP-18 | low    | MCP results are pretty-printed without a size cap, and the record does not say whether a person approved a write.                                     | open   |

## Money

| ID      | Sev      | Finding                                                                                                                                    | Status |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| BILL-1  | critical | The trial never ends. Its end date is only displayed.                                                                                      | open   |
| BILL-2  | critical | Workers and warm apps switched on after checkout are never added to the subscription. Checkout breaks when the always-on price is missing. | open   |
| BILL-3  | critical | After a cancel, workers and warm apps keep running for free.                                                                               | open   |
| BILL-4  | high     | After an abandoned or cancelled checkout a space can never subscribe again: it only offers the portal.                                     | open   |
| BILL-5  | high     | Webhooks are applied in whatever order they arrive, for whichever subscription they name.                                                  | open   |
| BILL-6  | high     | Two admins, or two tabs, can create two customers and two subscriptions.                                                                   | open   |
| BILL-7  | high     | Deleting a space while a checkout is open leaves a subscription charging for a space that no longer exists.                                | open   |
| BILL-8  | high     | The five-minute health probe keeps apps with sidecars running all the time (they are billed per instance), and nobody pays for it.         | open   |
| BILL-9  | medium   | A subscription set to cancel at the end of its period, or one that has expired, still blocks deleting the space.                           | open   |
| BILL-10 | medium   | Cira never emails anyone about a failed payment or a cancellation, and Stripe's own emails go to whichever admin first clicked subscribe.  | open   |
| BILL-11 | medium   | Apps deleted this month disappear from this month's usage.                                                                                 | open   |
| BILL-12 | medium   | One person can open any number of trial spaces.                                                                                            | open   |
| BILL-13 | low      | Only one `v1` signature is checked, so rotating the webhook secret can fail.                                                               | open   |
| BILL-14 | low      | Coming back from checkout before the webhook arrives still shows "Trial".                                                                  | open   |
| BILL-15 | low      | Keep-warm can end up on at Google but off in Cira if the database write fails.                                                             | open   |

## Alerts

| ID      | Sev    | Finding                                                                                                                                 | Status |
| ------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| ALERT-1 | high   | An alert that fails to send is lost forever: it is claimed first and never retried. Resend's rate limit makes that likely in an outage. | open   |
| ALERT-2 | medium | Nothing limits how many emails a flapping app, a crashlooping worker, or a failing five-minute job sends.                               | open   |
| ALERT-3 | medium | A worker that crashes without running out of memory is never reported, but is still billed.                                             | open   |
| ALERT-4 | medium | The billing sync runs last in the watcher, so a slow run can starve it.                                                                 | open   |

## Found by hand

Found while using the product end to end, as a new company would.

| ID   | Sev    | Finding                                                                                                                                                              | Status |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| UX-1 | medium | Sign-up is a bare Clerk card with no Cira mark, no mention of the trial, and no way back. It also asks for a password, although sign-in is described as email codes. | open   |
| UX-2 | low    | Every page is titled "Cira", including sign-up and sign-in.                                                                                                          | open   |

## Fixes

What changed for each finding, and where its test is.

- **SEC-1** (fixed). Redeploying an existing app takes the right to manage it (`userManages` in `lib/app-rights.ts`), checked before anything is written or sent to Google. Manage is now also a level on a grant (`app_access.level`, migration 0031), so a team of engineers can share an app without routing every deploy through its owner. Tests: `deploy-service.test.ts` (who may redeploy an app), `permissions.test.ts`, `access-actions.test.ts`.
- **SEC-2** (fixed). Both routes now take the right to manage the app, the same as the deploy they follow.
- **SEC-9** (fixed). Following a deploy takes the right to open the app. The route now reconciles through `reconcileDeployment` like every other place a deploy is looked at.
- **SEC-10** (fixed). Removed. It had no callers.
- **DEPLOY-1** (fixed). A deploy now carries an `EnvChange` (set these, unset those), never the whole set. The provider reads the current variables back from Google and applies the change, and the recorded names are merged the same way. Taking a variable away is an explicit `unset`. Tests: `provider.test.ts` (variables on a redeploy), `processes.test.ts`, `deploy-service.test.ts`. Design: `docs/secrets.md`.
- **DEPLOY-2** (fixed). The next variables are written into a revision that takes no traffic, pinned to the one serving. The new code and the new variables go live together at the swap. Workers and jobs beside a web service keep their variables until the swap. An app that is only workers and jobs has nowhere to hold them, so for it they still apply when the deploy starts (documented in `docs/secrets.md`). Tests: `provider.test.ts`, `processes.test.ts` (an app with a web service and a worker).
- **DEPLOY-3** (fixed). New terminal status `superseded` (migration 0032). Starting a deploy supersedes every older one of the app still in flight, and reconciling checks for a newer deploy before asking the provider, since asking is what rolls a build out. A superseded deploy changes nothing about the app and emails nobody. Tests: `deploy-service.test.ts` (two deploys of one app).
- **DEPLOY-4** (fixed). `teardown` removes every job, worker pool and timetable before the service and images. It runs for every service an app ever ran under. Tests: `processes.test.ts` (takes every process down when the app is torn down), `app-teardown.test.ts`.
- **DEPLOY-5** (fixed). A redeploy passes the service name from the app's last deployment, so renaming an app or its space no longer creates a second service. Teardown removes every name an app ever ran under, which also cleans up apps renamed before this fix. Tests: `provider.test.ts`, `app-teardown.test.ts`.
- **DEPLOY-8** (fixed). A first deploy that never got going removes the app it created, so a retry is the same app at the same address. A redeploy that never got going puts the app back to its previous status, because its last good version is still serving. Tests: `deploy-service.test.ts`.
- **DEPLOY-10** (partly). The server now waits 35 minutes, the full build timeout plus rollout, before calling a deploy abandoned (`deployment-staleness.ts`). The CLI's own 10-minute wait changes with the next CLI release.
