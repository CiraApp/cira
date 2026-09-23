# Cira

Deploy internal software to your company, and let the people there use it.

```sh
npm i -g @cira-app/cli
cira login
cira deploy
```

That is the whole workflow. Build a normal app in whatever it is written in;
Cira packages it, hosts it, and puts it on the shelf your colleagues already
open. Nobody configures cloud infrastructure, and nobody outside your company
can reach it.

## Commands

|                      |                                                                     |
| -------------------- | ------------------------------------------------------------------- |
| `cira login`         | Connect this machine. Approve it in a browser; works over SSH.      |
| `cira deploy`        | Deploy this folder. `--space <slug>` when you are in more than one. |
| `cira remove`        | Take this folder's app down, and delete what it left behind.        |
| `cira database url`  | The app's database address, for `psql` or `pg_dump`.                |
| `cira cache url`     | The app's cache address, for `redis-cli`.                           |
| `cira status`        | What this folder is linked to.                                      |
| `cira whoami`        | Who you are signed in as, and your spaces.                          |
| `cira skill install` | Add the Cira Skill to your coding agents.                           |
| `cira update`        | Update Cira, and the Skill copies you approved.                     |
| `cira logout`        | Forget the stored credential.                                       |

## Capabilities

Deploying also publishes what your app can _do_. Cira reads the code, works out
which routes are business operations worth exposing, and registers them - no
manifest, no MCP server, nothing Cira-specific in your repository.

A read-only capability turns itself on. Anything that writes is registered and
left off until someone reviews it. Nothing is offered to an assistant until the
running app has confirmed it serves the route, because reading code can be
wrong and the app cannot. Authorised colleagues can then reach those operations
from their own AI assistants, through Cira's permission checks.

## What your app needs to run

Cira reads the repository before it builds and says what the app expects to be
told - a database, a cache, anywhere it reads the environment with nothing to
fall back on, and any setting whose default points at your own machine. The
last of those is the one that catches people out: the app starts, because
there is a default, and the default names something that does not exist inside
a container.

```text
Environment (from .env)
  ✓ DATABASE_URL
  ✗ REDIS_URL    defaults to localhost, in apps/api/app/config.py

! 1 missing. It will build, and the app may not work without it.
```

Anything missing can be typed in at the prompt. It is not echoed, it is used
for that deploy, and it is kept in your `.env` so the next deploy does not ask
again. Going ahead without it takes the word `skip`, typed out - Enter alone
does not count, because a prompt that continues on Enter is a prompt nobody
reads.

It is a warning, never a refusal. Cira is reading your source and can be wrong.
`--yes` skips the whole exchange, and CI is never asked at all.

## A database or a cache

An app that keeps anything needs somewhere to keep it. Ask for one and Cira
makes it, just for this app, and gives it to the app as the variable its code
reads:

```sh
cira deploy --database   # Postgres, as DATABASE_URL
cira deploy --cache      # Redis, as REDIS_URL
```

When Cira sees code reading a `DATABASE_URL` or `REDIS_URL` that nothing sets,
it offers the same thing at the prompt. The database or cache belongs to the
app: it is there on every deploy after, and removing the app deletes it. A
`DATABASE_URL` the app already has is never replaced.

## An app that is a frontend and an API

Plenty of internal software is two things: a frontend, and the API behind it.
They are one product, so Cira keeps them one entry on the shelf - and one
address, one set of permissions, one thing to open.

You do not configure this. `cira deploy` reads what each half already carries -
a Dockerfile, a `package.json` with a way to start, a `pyproject.toml` - and
says what it found before it builds:

```text
Found 2 services
  api  apps/api  Dockerfile, internal, port 8000
  web  apps/web  nextjs, front door
```

Both halves run together, sharing `localhost`. So a frontend already written to
proxy to its backend in development finds it at the same address in production,
with no change and no environment variable to set - in development it was
already talking to localhost.

The half a browser opens is the one that gets the address. The other is
reachable only from inside, which is what keeps an API private without it
needing an address of its own.

If Cira cannot tell which half a browser should open, it says so and stops
rather than deploying something that builds, runs, and serves the wrong thing.

## The Cira Skill

`cira login` offers to install a short skill file into the coding agents it
finds - Claude Code, Codex, Pi, Gemini CLI and Cursor - so they know how to
build for Cira and how to deploy it. It asks once and defaults to yes;
declining writes nothing.

## Environment

|                |                                                        |
| -------------- | ------------------------------------------------------ |
| `CIRA_API_URL` | Point at a different Cira.                             |
| `CIRA_HOME`    | Where the credential is stored. Defaults to `~/.cira`. |

## Licence

Apache 2.0. The CLI is a thin client; Cira itself is a hosted service.
