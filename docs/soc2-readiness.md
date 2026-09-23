# SOC 2 readiness

What an auditor would look at for a SOC 2 Type I on Security (the Common
Criteria), with Availability and Confidentiality, mapped to what Cira actually
does. Written 2026-09-22 from the code and the running system, not from
intentions; updated 2026-09-23 as gaps were closed. No audit is planned (your call); this is the work an audit would
start from, and the list of what it would find missing.

A SOC 2 report is an opinion a licensed CPA firm signs. Nothing here replaces
that. What this does replace is the months of discovery before it.

Status: **in place** (a control exists and there is evidence), **partial**
(exists but incomplete or unevidenced), **gap** (missing).

## CC1-CC2 Control environment and communication

| Control                                  | Status   | Evidence                                                                                                |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| Public statement of what the system does | in place | `/legal/security`, `/legal/privacy`, `/legal/subprocessors`, `/docs`                                    |
| Customers told of changes and incidents  | partial  | Email to app managers for app events (`lib/notify.ts`); no status page or customer-wide incident notice |
| Written security policies                | gap      | None beyond this document and `docs/secrets.md`                                                         |
| Roles and responsibilities               | gap      | One operator; no written division of duties                                                             |

## CC3 Risk assessment

| Control                          | Status   | Evidence                                                               |
| -------------------------------- | -------- | ---------------------------------------------------------------------- |
| Known risks recorded and tracked | in place | `docs/hardening.md`, every finding with severity and fix               |
| Periodic risk review             | gap      | The ledger is written as things are found, not reviewed on a timetable |

## CC5-CC6 Logical access

| Control                                   | Status   | Evidence                                                                                                                        |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Authentication                            | in place | Clerk, emailed codes, no passwords; SAML SSO per company (`lib/sso.ts`)                                                         |
| Least privilege inside a customer         | in place | Space roles, per-app grants, teams (`lib/app-rights.ts`, `packages/core` `canAccessApp`); writes off until enabled              |
| Access removed when people leave          | in place | Removal and SCIM deactivation share one path (`lib/departure.ts`), grants and seats removed, rejoin blocked                     |
| Agents act only as their person           | in place | MCP under the same rules; writes need that person's approval, spent once (`lib/approvals.ts`)                                   |
| Credentials Cira issues are stored hashed | in place | CLI, invite, SCIM and approval tokens (`lib/token-hash.ts`)                                                                     |
| Customer secrets not stored               | in place | `docs/secrets.md`; values pass to Google, only fingerprints kept                                                                |
| No long-lived cloud keys                  | in place | Google by workload identity federation, no key files (`packages/deploy/src/cloudrun/auth.ts`)                                   |
| Tenant isolation                          | partial  | Per-app Cloud Run services, per-app databases and caches; all companies share one Google project (roadmap 3.2)                  |
| Operator access to production             | partial  | Vercel, Neon, Google, Cloudflare, Clerk, Stripe accounts of one person; the Cloudflare token is personal and expires 2026-09-30 |
| Periodic access review                    | gap      | Nothing reviews who holds admin in a space, or who holds operator access, on a schedule                                         |

## CC7 System operations

| Control                          | Status   | Evidence                                                                                                             |
| -------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| Monitoring of Cira itself        | in place | Sentry errors, uptime monitor on `/api/health` and the proxy                                                         |
| Monitoring of customers' apps    | in place | Watcher every five minutes, emails on outages, crashes, failed runs and deploys (`lib/watch.ts`)                     |
| Record of who ran what           | in place | `invocations`, never the input or output                                                                             |
| Record of administrative changes | in place | `space_changes`, written by the actions themselves; shown to admins at `/<space>/~/changes` (`lib/change-record.ts`) |
| Incident handling                | partial  | Incidents are fixed and written up in the ledger (DEPLOY-30); no written response procedure or customer notice       |

## CC8 Change management

| Control                           | Status   | Evidence                                                                                               |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| Every change tested before deploy | in place | CI runs format, types, lint, all tests and a build; deploy gated on it                                 |
| Migrations additive, in order     | in place | `packages/db/migrations`, applied by CI before the app                                                 |
| Peer review of changes            | gap      | Pushed directly to `prod` by one person; branch protection needs GitHub Pro                            |
| Dependency updates                | in place | Dependabot weekly for npm, monthly for actions, security fixes on their own (`.github/dependabot.yml`) |
| The app proxy deployed by process | partial  | Manual `ship`, now refusing a secret Cira rejects; not deployed by CI                                  |

## CC9 Vendors

| Control                    | Status   | Evidence                                                                                 |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| Subprocessors listed       | in place | `/legal/subprocessors`                                                                   |
| Vendors' own SOC 2 reports | gap      | Not collected (Google, Vercel, Neon, Clerk, Cloudflare, Stripe, Upstash all publish one) |

## A1 Availability and C1 Confidentiality

| Control                | Status   | Evidence                                                                                    |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------- |
| Backups of Cira's data | partial  | Restore drilled 2026-09-23 (`docs/restore.md`); only 6 hours of history on the current plan |
| Customer data export   | in place | Space export (`lib/space-export.ts`), `cira database url` for app data                      |
| Customer data deletion | in place | App removal deletes databases, caches and names; space deletion everything                  |
| Encryption in transit  | in place | TLS everywhere, HSTS on Vercel; `rediss://` and `sslmode=require` for app data              |
| Encryption at rest     | in place | Provider-managed (Neon, Google, Upstash)                                                    |

## The gaps, in the order worth closing

1. **Peer review before production.** GitHub Pro for branch protection, and a
   second person to review; with one person, at least a required CI check.
2. **Longer database history.** Restore is drilled (`docs/restore.md`), but
   Neon keeps only 6 hours on the current plan; a paid plan keeps days.
3. **Written policies.** Security, access control, incident response, change
   management, vendor management - short, and matching this document.
4. **Access review.** Quarterly: who holds operator access to each vendor, who
   is an owner or admin of each space.
5. **Tenant isolation.** A Google project per company (roadmap 3.2).
6. **Vendors' reports.** Download each subprocessor's SOC 2 and keep them.
