Build **Cira**.

Cira is a minimal, friendly platform for deploying and using internal company software.

The core idea is extremely simple:

> **Developers deploy software to Cira. Employees open Cira and use the software they have access to.**

Do not overbuild this.

Do not turn Cira into AWS, Railway, Backstage, Retool, or a generic developer portal.

The product should feel closer to **Linear, Slack, or a game library like Steam** in terms of simplicity.

---

# 1. Product mental model

Cira has only a few important concepts:

```text
User
  │
  ▼
Space
  │
  ▼
Apps
```

A **Space** is usually a company.

Example:

```text
Cira

Acme
├── Revenue Dashboard
├── Invoice Matcher
├── Lead Cleaner
└── Support Console
```

Employees use Cira like an app library.

Developers use Cira as a deployment target.

---

# 2. Employee experience

The employee experience should be almost absurdly simple.

```text
Employee
   │
   ▼
Open Cira
   │
   ▼
See company apps
   │
   ▼
Click an app
   │
   ▼
Use it
```

Main UI:

```text
┌────────────────────────────────────────────────────────────┐
│ cira                                           Aum ▾       │
│                                                            │
│ Acme                                                       │
│                                                            │
│ Search apps...                                             │
│                                                            │
│ ┌─────────────────┐  ┌─────────────────┐                  │
│ │                 │  │                 │                  │
│ │ Revenue         │  │ Invoice         │                  │
│ │ Dashboard       │  │ Matcher         │                  │
│ │                 │  │                 │                  │
│ │ Finance         │  │ Finance         │                  │
│ └─────────────────┘  └─────────────────┘                  │
│                                                            │
│ ┌─────────────────┐  ┌─────────────────┐                  │
│ │                 │  │                 │                  │
│ │ Lead Cleaner    │  │ Support Console │                  │
│ │                 │  │                 │                  │
│ │ Sales           │  │ Support         │                  │
│ └─────────────────┘  └─────────────────┘                  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

The app gallery is the primary interface.

Do not show:

- containers
- services
- regions
- Kubernetes
- infrastructure graphs
- cloud resources
- complex deployment concepts

unless absolutely necessary in a deeper developer/admin screen.

Clicking an app should open the deployed application.

---

# 3. Developer experience

Developers should be able to deploy an internal app into the company Space.

Target flow:

```text
Developer / Coding Agent
        │
        │
        ▼
smallcloud-style deploy command
        │
        ▼
Cira receives app
        │
        ▼
Build + deploy
        │
        ▼
Choose access
        │
        ▼
App appears in Space
```

Use the command:

```bash
cira deploy
```

Example:

```text
$ cira deploy

Detecting application...
✓ Next.js app

Building...
✓ Build complete

Deploying to Acme...
✓ Deployed

Who should have access?

> Only me
  Finance
  Sales
  Everyone
  Custom

✓ Revenue Dashboard is now available to Finance

Open:
https://cira.app/acme/revenue-dashboard
```

The important product principle is:

> **Deployment and distribution happen together.**

Once an app is deployed, it automatically belongs to the Space and becomes visible to the correct users.

---

# 4. Core architecture

Keep the architecture intentionally small.

```text
                    ┌───────────────────┐
                    │    Cira Web App   │
                    │                   │
                    │  Employee gallery │
                    │  App management   │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │     Cira API      │
                    │                   │
                    │ users             │
                    │ spaces            │
                    │ apps              │
                    │ memberships       │
                    │ permissions       │
                    │ deployments       │
                    └─────────┬─────────┘
                              │
               ┌──────────────┴──────────────┐
               │                             │
               ▼                             ▼
      ┌─────────────────┐           ┌─────────────────┐
      │   PostgreSQL    │           │ Deploy Adapter  │
      │                 │           │                 │
      │ Cira metadata   │           │ external cloud  │
      └─────────────────┘           └────────┬────────┘
                                             │
                                             ▼
                                  ┌─────────────────────┐
                                  │ Existing Provider   │
                                  │                     │
                                  │ Railway / similar   │
                                  └─────────────────────┘
```

Cira should **not own compute infrastructure in V1**.

Use an external deployment provider behind an abstraction.

Create a deployment interface so the provider can be replaced later.

Example:

```ts
interface DeploymentProvider {
  deploy(app: AppDeploymentInput): Promise<DeploymentResult>
  getStatus(deploymentId: string): Promise<DeploymentStatus>
  remove(deploymentId: string): Promise<void>
}
```

The rest of Cira should not know which provider is being used.

---

# 5. Recommended stack

Use a boring, fast stack.

Preferred:

```text
Frontend / web app
Next.js
TypeScript
React

Backend
Next.js server/API routes or a small separate TypeScript API

Database
PostgreSQL

ORM
Drizzle or Prisma

Authentication
Clerk, Auth.js, or another simple hosted auth provider

Deployment
Start with one provider only.

CLI
Node.js + TypeScript
```

Do not introduce microservices.

Do not introduce Kubernetes.

Do not introduce Redis unless genuinely needed.

Do not introduce message queues unless genuinely needed.

Prefer a simple monorepo.

Suggested:

```text
/apps
  /web

/packages
  /db
  /core
  /deploy
  /cli
  /ui
```

---

# 6. Core data model

Keep the data model simple.

## User

```text
id
name
email
createdAt
```

## Space

```text
id
name
slug
createdAt
```

## Membership

```text
id
userId
spaceId
role
```

Roles:

```text
owner
admin
member
```

## App

```text
id
spaceId
name
slug
description
status
icon
ownerUserId
createdAt
updatedAt
```

## AppAccess

Controls who can see/use an app.

Start simple.

```text
id
appId
type
targetId
```

Possible access types:

```text
user
space
```

If team/group support is easy, add:

```text
group
```

Otherwise do not build groups yet.

## Deployment

```text
id
appId
provider
providerDeploymentId
status
url
createdAt
updatedAt
```

---

# 7. Authentication and authorization

Cira authentication and application access are central to the product.

Cira needs to know:

```text
Who is this user?

Which Space are they in?

Which apps can they access?
```

For V1:

```text
Cira login
   │
   ▼
User identity
   │
   ▼
Space membership
   │
   ▼
App permission
```

If possible, place deployed apps behind a simple Cira auth gateway or proxy.

Conceptually:

```text
Employee
   │
   ▼
Cira App URL
   │
   ▼
Cira Access Check
   │
   ├── no access → denied
   │
   └── access
          │
          ▼
      Deployed app
```

Do not build enterprise SSO, SCIM, SAML, complicated RBAC, etc. in V1.

The architecture should allow those later.

---

# 8. Onboarding

Keep onboarding extremely lightweight.

First login:

```text
Welcome to Cira
```

Then:

```text
Create your Space

Company or team name

[ Acme                     ]

[ Create Space ]
```

After creation:

```text
Acme is ready.

[ Invite people ]

or

[ Go to Cira ]
```

Do not force a long setup wizard.

Do not ask unnecessary questions.

---

# 9. Main employee dashboard

The homepage should focus entirely on applications.

Top level:

```text
Cira

Acme

Search apps...

Your apps

[ app ]
[ app ]
[ app ]
```

Use a responsive grid.

App cards should contain only what matters:

```text
App icon

App name

Small secondary label
```

Example:

```text
┌────────────────────┐
│                    │
│       ◉            │
│                    │
│ Revenue Dashboard  │
│ Finance            │
│                    │
└────────────────────┘
```

Clicking the card opens the application.

Favor whitespace.

Favor large click targets.

Favor minimal copy.

Avoid dense tables.

Avoid sidebars full of navigation.

Avoid cloud-console aesthetics.

---

# 10. Developer/admin app view

Developers need slightly more information.

Clicking "Manage" on an app can show:

```text
Revenue Dashboard

[ Open ]

Status
● Live

Access
Finance

Owner
Aum

Deployment
Healthy

Last deployed
5 minutes ago
```

Then simple tabs or sections:

```text
Overview
Access
Deployments
Settings
```

No more than this for MVP.

Deployment details can contain basic build/output logs.

---

# 11. Deploy flow

Support one application type initially.

Prefer:

```text
Next.js
```

Optionally support generic Node after that.

Do not attempt arbitrary languages/runtimes initially.

CLI flow:

```text
cira login

cira deploy
```

`cira deploy` should:

```text
1. Detect current project
2. Validate supported framework
3. Package/source upload
4. Send deployment request
5. Deploy through DeploymentProvider
6. Create/update App record
7. Return URL
8. Ask for access permissions if app is new
```

If redeploying an existing linked app:

```text
cira deploy
```

should redeploy it automatically without recreating it.

Store local project metadata in something like:

```text
.cira/project.json
```

Example:

```json
{
  "appId": "...",
  "spaceId": "..."
}
```

---

# 12. Deployment provider abstraction

Start with one external cloud.

Do not build Cira's own runtime.

Make this replaceable.

```text
Cira
   │
   ▼
DeploymentProvider
   │
   ▼
Provider API
```

Everything above this abstraction should remain unchanged if Cira later moves to:

```text
Fly
Cloudflare
AWS
custom runtime
```

---

# 13. Product rules

These rules are extremely important.

## Rule 1

Never expose infrastructure complexity unless necessary.

## Rule 2

Default to the simplest possible action.

## Rule 3

Employee UX and developer UX are different.

Employee:

```text
find app → open app
```

Developer:

```text
deploy app → choose access
```

## Rule 4

Every major feature should reinforce:

> Cira is where internal company software gets deployed and used.

If a feature does not reinforce this, leave it out.

## Rule 5

Do not invent "AI features" for V1.

Cira should work with Claude Code, Codex, Cursor, humans, or any other coding environment simply through the CLI.

## Rule 6

Do not create speculative enterprise features.

No:

```text
software intelligence
AI app maintenance
dependency graphs
automatic deduplication
complex governance engine
cost optimization
agent orchestration
```

These may be future features.

They are not part of the core.

---

# 14. Required MVP features

Build only:

```text
Authentication

Create Space

Join Space through invite

Space membership

App gallery

Search apps

App permissions

Deploy Next.js app

Redeploy app

Deployment status

Basic deployment logs

Open deployed app

Manage app

Invite users

Logout
```

That is enough.

---

# 15. Explicitly out of scope

Do NOT build:

```text
custom cloud infrastructure
multiple cloud providers
Kubernetes
custom domains
billing
usage metering
enterprise SSO
SCIM
SAML
advanced teams/groups
database provisioning
Redis
cron
object storage
secrets management platform
agent marketplace
AI assistant
software recommendations
software analytics
automatic app deletion
dependency maps
mobile apps
desktop apps
plugin marketplace
```

Unless something is absolutely required for the core deployment experience.

---

# 16. UX quality bar

The application should feel like a polished modern SaaS product.

Design references:

```text
Linear
Slack
Vercel
Steam library
Raycast
```

But Cira should be visually lighter and friendlier than a developer cloud.

The employee should never feel like they are looking at infrastructure.

Avoid:

```text
huge navigation trees
dense dashboards
too many settings
developer terminology
configuration-first UI
```

Prefer:

```text
cards
search
simple modals
clear status
one primary action
progressive disclosure
```

---

# 17. Core user journeys

## Journey A — Company setup

```text
New user
   │
   ▼
Sign up
   │
   ▼
Create "Acme" Space
   │
   ▼
Cira gallery
```

## Journey B — Developer deploys software

```text
Developer
   │
   ▼
Builds app locally / with coding agent
   │
   ▼
cira deploy
   │
   ▼
Select Acme
   │
   ▼
Select who can access
   │
   ▼
Cira deploys app
   │
   ▼
App appears in Acme
```

## Journey C — Employee uses software

```text
Employee
   │
   ▼
Opens Cira
   │
   ▼
Sees apps they can access
   │
   ▼
Clicks Revenue Dashboard
   │
   ▼
Application opens
```

That is the entire product loop.

---

# 18. Definition of success

The MVP succeeds if this demo feels excellent:

```text
1. I create an Acme Space.

2. I invite another employee.

3. I have a simple Next.js internal tool locally.

4. I run:

   cira deploy

5. Cira deploys it.

6. I give the other employee access.

7. The app immediately appears in their Acme gallery.

8. They click the app.

9. The app opens.

10. Neither of us had to understand or configure cloud infrastructure.
```

If this works beautifully, Cira has proven its core.

---

# 19. Implementation approach

Before coding:

1. Inspect the repository.
2. Decide the simplest architecture compatible with this spec.
3. Create a concise implementation checklist.
4. Then implement directly.

Do not spend time creating an elaborate planning framework.

Build in vertical slices.

Recommended order:

```text
Phase 1
Project structure + auth + DB

Phase 2
Spaces + memberships + invites

Phase 3
App gallery

Phase 4
Apps + permissions

Phase 5
CLI authentication

Phase 6
DeploymentProvider abstraction

Phase 7
Actual provider deployment

Phase 8
cira deploy end-to-end

Phase 9
Basic app management + logs

Phase 10
UI polish + end-to-end tests
```

After every phase:

```text
run typecheck
run lint
run tests
```

Keep CI green.

---

# 20. Engineering standards

Use strict TypeScript.

Use clear boundaries.

Keep functions small.

Validate API inputs.

Authorization must be checked server-side.

Do not trust client-supplied Space or user IDs.

Never expose provider secrets to browsers.

Use migrations for schema changes.

Add unit tests for permission logic.

Add integration/e2e tests for the critical flow:

```text
create space
→ invite member
→ create app
→ grant access
→ member sees app
```

And ultimately:

```text
deploy
→ app becomes available
→ employee opens app
```

Prefer maintainability over abstraction.

Do not create abstractions before they are useful.

---

# Final product principle

Throughout implementation, optimize around one sentence:

> **Cira lets developers deploy software directly to their company, and lets employees use that software from one simple place.**

If a design or engineering decision makes that harder to understand, simplify it.