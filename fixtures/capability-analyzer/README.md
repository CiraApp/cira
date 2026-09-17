# Capability analyzer fixture

A fake app in five frameworks, and the answer key for it.

The analyzer reads a repository and says what the app can do. That is one model
call, so it cannot be tested the way the rest of the codebase is tested - there
is no assertion that makes a judgement correct. What there is instead is a
corpus small enough to run against repeatedly, and a list of what the right
answer looks like.

## Why it exists

The prompt is the part of the analyzer most likely to be changed and least
likely to be checked. Running it against a real repository costs about 345,000
tokens; running it against this costs about 30,000. That difference is the only
reason the prompt went through four revisions rather than one.

It also catches what a real repository cannot. Any one app is one framework.
This is five, each carrying the specific thing that breaks a careless reading:

| File                                          | What it is there to test                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `svc-orders/app/routers/orders.py`            | a router mounted under a prefix built from a setting - two hops to `/api/v2/orders` |
| `web/src/app/api/invoices/[id]/void/route.ts` | the path is the directory structure, and one file is two operations                 |
| `gateway/src/server.js`                       | `app.use(prefix, router)`                                                           |
| `reporting/app.rb`                            | top-level declarations with no mount at all                                         |
| `ingest/main.go`                              | the method packed into the pattern string                                           |

An earlier prompt scored 12/12 against a real FastAPI app and 10/12 here,
because it had nothing to say about the last two. Neither failure would have
appeared in a repository written in one language.

## Running it

```sh
# 1. the prompt the analyzer actually ships with
node fixtures/capability-analyzer/prompt.mjs

# 2. run it over corpus.txt - by hand, through an agent, or through the API -
#    and save the JSON it returns

# 3. score it
node fixtures/capability-analyzer/score.mjs result.json
```

Anything short of perfect exits non-zero. It is not part of `pnpm test`,
because it needs a model and tests that cost money and vary run to run are
tests people learn to ignore.

## The files

- `corpus.txt` - the fake app, packed the way `packSource` packs a real one
- `truth.txt` - the twelve routes it actually serves, prefixes resolved
- `excluded.txt` - health, liveness, metrics and auth, which must never become
  capabilities
- `prompt.mjs` - prints the shipped prompt, read from the source so there is no
  second copy to drift
- `score.mjs` - compares a run against the answer key

## Removing it

Delete the directory. Nothing imports it, no build references it, and no test
runs it.
