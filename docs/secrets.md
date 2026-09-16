# Environment variables and secrets

Almost every real internal app needs a credential: a database URL, an API key
for the model it calls, a token for the system it reads. Cira deploys on the
developer's behalf, so the developer never touches the provider's dashboard and
has nowhere to put one. Until this existed, an app that needed a secret could
not be deployed to Cira at all.

## The rule

**Cira is a conduit, not a vault.**

A value passes through one authenticated request, is handed to the deployment
provider, and is never written to Cira's storage. What Cira keeps is the _fact_
of a variable - its name, a short fingerprint, and who set it - so the app page
can show what is configured and an admin can see what changed. The values
themselves exist in exactly three places: the developer's machine, the request
in flight, and the provider.

This is the whole design, and everything below follows from it.

### Why not store them

The alternative is a secrets manager: encrypted columns, a root key in a KMS,
an envelope scheme, rotation, re-encryption on key roll, and an audit surface
for reads. All of that is real work, and all of it exists to solve a problem
Cira does not have - because the provider already stores deployment
configuration securely, and Cira's job is only to get the values there.

The security argument is stronger than the effort one. A database Cira does not
hold is a database that cannot leak. Today `apps.access_secret` is the only
credential Cira stores and it is plaintext, with a comment saying so. Adding a
hundred customers' API keys beside it would turn a known weakness into a company
-ending one. Passing values through keeps Cira's blast radius exactly where it
is.

If a customer one day needs Cira to hold values - to rotate them from the UI, or
to satisfy a compliance team - that is a deliberate later project with a real
key-management story, not something to grow into by accident.

## The path

```
  .env.local                 cira deploy                POST /api/cli/deploy
  on the developer's   ──▶   reads and sends      ──▶   authenticates, validates,
  machine                    over TLS                   checks canManageApp
                                                                │
                                                                ▼
   app_env_vars                                        POST /v13/deployments
   name + fingerprint   ◀──  recorded, values    ──▶   env + build.env inline
   + who + when              discarded                 (the provider stores them)
```

### Inline on the deployment, not on the project

Vercel offers two places to put variables: on the project, where they persist
across deployments, and on the deployment itself. Cira uses the deployment.

The reason is the first deploy. A Cira project does not exist until the first
deployment creates it - `secureProject` looks it up afterwards - so there is no
project to attach variables to when the first build runs, which is exactly the
build most likely to need them. Deployment-inline variables are present for the
first build and every build after it.

The cost is that the values are attached per deployment rather than inherited,
so every deploy carries the full set. That is fine, because every deploy comes
from `cira deploy`, which reads them fresh from the developer's machine. The
developer's environment is the source of truth, and there is only one.

Both `env` and `build.env` are set from the same map. Next.js needs some
variables while building and some while serving, and asking a developer which is
which is a question they should not have to answer.

## What Cira records

One row per variable per app, holding no value:

| Column                         | Why                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `key`                          | So the app page can list what is configured                                                                 |
| `fingerprint`                  | First 8 hex of the SHA-256. Enough to see _that_ a value changed between deploys, useless for recovering it |
| `is_public`                    | True for `NEXT_PUBLIC_*`, which Next.js compiles into the browser bundle                                    |
| `set_by_user_id`, `updated_at` | Who last set it, and when                                                                                   |

A variable that stops being sent is removed from the record, so the list always
describes the live deployment rather than accumulating history.

### `NEXT_PUBLIC_` is a trap, so it is labelled

A variable named `NEXT_PUBLIC_ANYTHING` is inlined into the JavaScript the
browser downloads. Putting a secret there is unrecoverable - it is published the
moment the build finishes, and rotating is the only fix. Cira cannot refuse the
prefix, because plenty of legitimate values use it, so instead:

- the CLI prints a warning naming each public variable before sending
- Cira records the flag and the app page marks those variables as visible to
  anyone who opens the app

Naming the hazard is worth more than guessing at intent.

## Limits

Deliberately tight, because a deploy request is not a file upload:

- 100 variables per app
- 4 KB per value, 64 KB total
- Keys match `^[A-Za-z_][A-Za-z0-9_]*$`, which is what a shell and a build both
  accept

## Who may set them

Setting a variable is managing the app, so it takes the same rights: the app's
owner, or an admin of the space. A first deploy creates the app with the
deployer as owner, so it passes by construction.

## What is never done

- **Values are never logged.** Not in the CLI, not in the deploy route, not in
  provider errors. The CLI prints names; failures name the variable, never its
  contents.
- **Values are never returned.** No Cira endpoint reads a value back, including
  to the person who set it. Replacing is the only edit.
- **`.env` files are never uploaded.** `bundle.ts` excludes them, and that stays
  true: a file in the bundle becomes a file in the build, and can end up in build
  output. Variables travel as variables.

## Where a value can be found afterwards

Worth writing down, because "where are my secrets" is the question every
security review asks:

| Place                              | Holds the value                 |
| ---------------------------------- | ------------------------------- |
| Developer's machine (`.env.local`) | Yes - the source of truth       |
| Network, developer to Cira         | In flight, under TLS            |
| Cira's server memory               | For the duration of one request |
| Cira's database                    | **No**                          |
| Cira's logs                        | **No**                          |
| Vercel deployment config           | Yes                             |
| The running app's environment      | Yes                             |
