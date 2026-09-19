# Backend-only service fixture

An orders service with no web page, and the answer key for what Cira should
make of it.

An app whose root serves no page has no front door in Cira: no **Open** button
from the homepage check, and until the capability console, no way in at all
except an agent over MCP. This is the app to develop and test that path
against. It is small, it has no dependencies, and every route is there to put
Cira into one particular state.

## Why it looks like this

- **Python, standard library only.** No framework, so there are no decorators or
  router objects for the analyzer to lean on - only a table of routes at the
  bottom of `app.py`. That is the least convenient shape a real service takes,
  and a different one from everything in `fixtures/capability-analyzer`, so it
  tests the claim that Cira reads any language. It also means CI can run it: a
  GitHub runner already has Python 3, and there is nothing to install.
- **A Dockerfile**, so a deploy exercises that path rather than buildpack
  detection.
- **No database, no calls out.** Orders live in memory, seeded the same way on
  every start. Writes change them visibly - a refunded order reads as refunded
  afterwards - and a restart or `POST /__reset` puts them back.

## Expected capabilities

This table is the oracle. `apps/web/src/lib/console.e2e.test.ts` reads it and
asserts against it, so change it only alongside the service.

| Method | Path                  | Risk  | Reach    | Enabled | Why                                                                         |
| ------ | --------------------- | ----- | -------- | ------- | --------------------------------------------------------------------------- |
| GET    | `/orders`             | read  | callable | yes     | Called with its example input and answers 200.                              |
| GET    | `/orders/lookup`      | read  | callable | yes     | Answers 200 for a real id. See the caveat below.                            |
| GET    | `/revenue`            | read  | callable | yes     | Called with two dates and answers 200.                                      |
| GET    | `/customers/top`      | read  | callable | yes     | Called with no input and answers 200.                                       |
| GET    | `/admin/audit`        | read  | refused  | yes     | Always answers 401. The route is real; Cira cannot get through it.          |
| POST   | `/orders/refund`      | write | callable | no      | Never called to verify - `OPTIONS` answers `Allow: POST`. Writes start off. |
| POST   | `/reports/regenerate` | write | callable | no      | The same, and `report` is an enum.                                          |

"Enabled" is the publication default: reads switch themselves on, writes wait
for someone who manages the app. `/admin/audit` is enabled and still never
offered, because only a `callable` capability is.

### Not capabilities

| Route           | Why not                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /`         | A JSON description of the service, which is also what tells Cira there is no web page.                                         |
| `GET /health`   | Liveness, not a business operation.                                                                                            |
| `POST /__reset` | Test-only. Harmless if the analyzer proposes it anyway: it restores the seed data, and as a write it would start switched off. |

`truth.txt` and `excluded.txt` hold the same answer in the analyzer fixture's
format, so a run can be scored:

```sh
node fixtures/capability-analyzer/score.mjs result.json fixtures/backend-only-service
```

### The caveat on `/orders/lookup`

It answers 404 for an order id it does not know, as the task asked. But
verification reads a 404 as "no such route" and deletes the capability, so
whether `/orders/lookup` survives depends on the analyzer's example input using
a real id. The seed ids sit at the top of `app.py` where a reader will see them,
which makes that likely, not certain. A service whose lookups 404 on unknown
ids is ordinary; that verification cannot tell a missing resource from a
missing route is a limit of verification, recorded here so it is not mistaken
for this fixture misbehaving.

## What a deploy of it showed

Deployed with `cira deploy` (CLI 0.5.0) into a real space on 2026-09-19:

- **No front door.** The root answered JSON, so the app came up with no web
  interface, and its **Open** button leads to the capability console.
- **The table held, row for row.** Seven capabilities, named `listOrders`,
  `lookupOrder`, `getRevenue`, `getTopCustomers`, `getAudit`, `refundOrder` and
  `regenerateReport`. The four reads were confirmed and switched on, `getAudit`
  landed in `refused`, and both writes were confirmed by `OPTIONS` and left off.
  `report` came through as an enum.
- **`/orders/lookup` survived.** The analyzer's example used a seeded id, so
  verification got a 200 rather than the 404 the caveat above warns about.
- **Neither `/health` nor `/__reset` was proposed.**
- **The CLI flagged `QUIET` as missing.** That was a switch this service had
  for silencing its request log, and two things were wrong. The switch was
  dead: its only caller, the console test, discards the service's output
  anyway, so it is gone. And the environment scan counted a value that is only
  ever compared with a literal - `os.environ.get("QUIET") != "1"` - as one the
  app needs, when unset is simply "off". It now leaves switches alone, which
  also stopped it asking Wave for a demo flag its production deliberately
  leaves unset.

## Running it

```sh
PORT=8080 python3 fixtures/backend-only-service/app.py
curl localhost:8080/orders
```

To deploy it into a space:

```sh
cd fixtures/backend-only-service && cira deploy
```

## Removing it

Delete the directory. The console's end-to-end test starts it and reads this
file, and skips itself when neither is there to find.
