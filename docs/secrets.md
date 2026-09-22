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
hold is a database that cannot leak. Cira stores no credential as itself: the
secrets it hands out - CLI tokens, invite links, the device code a `cira login`
polls with - are kept only as SHA-256 hashes (`lib/token-hash.ts`), so a copy of
the database opens nothing. Adding customers' API keys to it would undo exactly
that. Passing values through keeps Cira's blast radius where it is.

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
   app_env_vars                                        PATCH run.googleapis.com
   name + fingerprint   ◀──  recorded, values    ──▶   .../services/{app}
   + who + when              discarded                 (the runtime stores them)
```

### On the service, never in the build

A deploy is two acts. Cloud Build turns source into an image; Cloud Run turns
that image into something serving. The variables go to the second and never
touch the first.

That is the single most important rule in this document, because the tempting
shortcut is the dangerous one. Cloud Build takes `substitutions`, and passing
the environment through them would work on the first try. It would also publish
every value: a build's configuration is readable by anyone with access to the
project, its logs are stored in a bucket, and both outlive the build. A
database password put into a build step is a database password in a log file.

So the build request carries source, a builder, and an image name. Nothing
else. There is a test asserting it, because the failure is silent - a deploy
that leaks this way still succeeds.

### The environment lives in the service, and Cira reads it back

Cloud Run holds the variables, which is where a running app's environment
belongs. Cira sets them on the way past and keeps nothing.

One consequence is worth being explicit about. The image is not swapped into
the service until the build finishes, minutes after the request that carried
the variables has ended - and that swap has to rewrite the container, which
means restating its environment. Cira reads the current values back off the
service and writes them straight out again in the same request. They pass
through its memory exactly as they did on the way in, are never returned to a
caller, and are never written down.

The alternative would be for Cira to keep them until the build finished, which
is the thing this document exists to say it does not do.

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

## A deploy changes variables, it never replaces them

A deploy carries the variables it has - from the deployer's `.env` files and
`--env` flags - and those are set. Every variable it does not mention keeps
the value it already has at the provider. Taking one away is a separate,
explicit ask: `cira deploy --unset NAME`.

It used to replace the whole set with whatever one machine sent. That made
the developer's `.env` the only copy of production's configuration, and it
meant a teammate's fresh clone, or a CI job with no `.env` file, wiped every
production variable the moment it deployed. The provider is where a running
app's configuration lives, so that is what a deploy now starts from: it reads
the current variables back from the Cloud Run service (or, for an app with no
web service, from one of its workers or jobs), applies the change, and writes
the result. The values pass through Cira's memory for that one request, exactly
as they did before.

### They go live with the build, not before it

The new variables are written as soon as the deploy starts, because that is
the only moment Cira holds them. They are written into a revision that takes
no requests: traffic stays pinned to the revision already serving until the
new build is ready, and then the new code and the new variables go live
together. A deploy that renames `DB_URL` to `DATABASE_URL` therefore never
runs the old code without the name it reads, and a build that fails leaves the
app exactly as it was. Workers and scheduled runs beside a web service move
onto the new variables at the same moment as onto the new image.

An app that is only workers and scheduled runs has no service to hold the next
variables on, so for those they are applied when the deploy starts.

## Who may set them

Setting a variable is managing the app, so it takes the same rights: the app's
owner, an admin of the space, or someone given `manage` on the app from its
Access panel. Redeploying at all takes the same rights, since it replaces the
code everyone who opens the app runs. A first deploy creates the app with the
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
| Developer's machine (`.env.local`) | Yes, if they kept it            |
| Network, developer to Cira         | In flight, under TLS            |
| Cira's server memory               | For the duration of one request |
| Cira's database                    | **No**                          |
| Cira's logs                        | **No**                          |
| The Cloud Run service definition   | Yes                             |
| The running app's environment      | Yes                             |
