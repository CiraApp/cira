# Apps with their own sign-in

Status: built, 2026-09-20. Roadmap 2.7. The design below is what shipped; the
answers reached on the security questions are at the end.

## The problem

Cira calls an app's operations with an identity token minted for that app's
own URL and nothing else. Every header that could say who a person is, is
stripped: the allow-list in `invoke-capability.ts` is what makes it true that
"the call carries an identity token for that one app and nothing that
identifies a person".

That is exactly right for an app with no users of its own, and it is why an
app that _does_ have users answers 401. Cira records that honestly - the
capability becomes `refused`, and the page says the app asks everyone to sign
in and Cira cannot sign in on their behalf.

Most real internal software has its own sign-in. Today all of it lands in the
`refused` bucket, which means Cira's shelf shows a company its tools and then
declines to use the interesting half of them. This is the largest single
unlock left.

## What it must not become

- **A vault.** Cira does not hold anyone's password, session cookie or API
  key for another app, and this must not be the feature that introduces one.
  `docs/secrets.md` is not negotiable.
- **An impersonation service.** Nothing here may let one person's request
  reach an app as somebody else, and nothing may let an app be called as a
  person who never asked for it.
- **A header an app has to guess about.** If an app is going to believe a
  claim about who is calling, it must be able to verify that claim itself.

## The shape

Cira signs a short-lived assertion about the person making the call and sends
it beside the existing identity token. The app verifies it against Cira's
public keys and decides what that person may do. Cira learns nothing new, and
holds nothing new.

```
Person ──▶ Cira ──▶  x-serverless-authorization: <Google ID token for this app>
                     x-cira-identity:           <JWT signed by Cira>
                     ──▶ the app verifies the JWT and answers as that person
```

The assertion says only what Cira already knows and the app already needs:

| Claim                     | Why                                                                         |
| ------------------------- | --------------------------------------------------------------------------- |
| `iss`                     | `https://cira.dev`, so a verifier knows whose keys to fetch                 |
| `aud`                     | the app's deployment URL, so an assertion for one app is useless at another |
| `sub`                     | Cira's user id, stable for that person                                      |
| `email`, `email_verified` | what an app matches its own accounts on                                     |
| `name`                    | for an audit line the app writes itself                                     |
| `space`                   | the company, so an app serving several tells them apart                     |
| `via`                     | `mcp`, `ask` or `console`: an app may treat an agent differently            |
| `iat`, `exp`              | 60 seconds, because it is used immediately or not at all                    |

Keys are published at `/.well-known/cira-jwks.json`, rotated on a schedule,
with the previous key served until it expires. Signing is ES256 with the
private key held the way every other secret is: in the environment, never in
the database.

## What an app does

Enough to be worth writing in the docs in full, because the adoption cost is
the whole feature:

```python
# FastAPI, verified with any standard JWT library
claims = jwt.decode(
    request.headers["x-cira-identity"],
    key=cira_public_key,          # from /.well-known/cira-jwks.json
    algorithms=["ES256"],
    audience=MY_SERVICE_URL,
    issuer="https://cira.dev",
)
user = find_user_by_email(claims["email"])
```

An app that does nothing keeps behaving exactly as it does today.

## What changes in Cira

1. `invoke-capability.ts` gains one header, and the allow-list learns that
   `x-cira-identity` is the only identity header Cira ever sends. Everything
   else stays stripped, including anything inbound that tries to arrive with
   that name (see below).
2. A capability that answered 401 is no longer recorded as permanently
   refused when the app has opted in; it is retried once with the assertion
   and recorded on what that answers.
3. An app-level setting - off by default - says whether Cira sends it. An app
   is told who is calling only when its own managers asked for that.
4. The invocation record gains which identity was asserted, so "who ran what"
   stays true when the app is the thing enforcing permissions.

## What a security review has to decide

- **Inbound header injection.** A request arriving at Cira with
  `x-cira-identity` set must never survive into an outbound call. The proxy
  and the invocation path both need an explicit strip, and a test that fails
  loudly if either forgets.
- **Audience binding.** Is the deployment URL the right audience when an app
  is redeployed and its URL is stable but its build is not? Probably yes, but
  a rotated URL must invalidate assertions rather than silently widening them.
- **Agent calls.** An assistant acting for a person gets `via: mcp`. Is
  sending an assertion at all correct for a write an agent proposed and a
  person approved? Cira's own gate already stops unapproved writes, but the
  app should be able to apply its own policy, which is what `via` is for.
- **Key handling.** Rotation, the window where both keys verify, and what
  happens to an app that caches keys for a week.
- **Opt-in integrity.** The setting is per app and changeable by its
  managers. Is a manager turning it on enough, or should it require the app to
  prove it can verify - a handshake against a Cira-signed probe - before Cira
  starts asserting identities to it?
- **Blast radius.** If Cira's signing key leaked, an attacker could assert any
  identity to any app that trusts Cira. That is the same class of risk as any
  identity provider, and the answer is the same: short expiry, rotation, and
  the key never leaving the environment. It should still be written down
  before shipping, not after.

## What the security questions were answered with

- **Inbound header injection.** Cira never forwards an inbound header to an
  app: every outbound call builds its headers from scratch, and
  `speaksForNobody` is an allow-list over exactly that set. A header arriving
  at Cira called `x-cira-identity` reaches nothing. Through the browser proxy
  an app can be sent any header by the person at the keyboard, which is
  precisely why the assertion is signed and why the docs say to verify it
  rather than trust it.
- **Audience binding.** The app's own origin, which is stable across deploys
  and changes when the app is rebuilt somewhere else - in which case old
  assertions stop verifying, which is the safe direction.
- **Agent calls.** Sent, carrying `via`, so an app can hold an agent to a
  different standard than a person. Cira's own gate still stops an unapproved
  write before any of this.
- **Key handling.** Current and previous keys are published; only the current
  one signs. Rotation is two environment variables and a deploy.
- **Opt-in integrity.** A manager turning it on is enough. A handshake proving
  the app verifies was considered and left out: an app that ignores the header
  is exactly as safe as it is today, because the header alone changes nothing
  the app does.
- **Blast radius.** A leaked signing key would let someone assert any identity
  to any app that trusts Cira, which is the standing risk of any identity
  provider. Mitigated by the sixty-second life, by rotation, and by the key
  living only in the environment. Worth revisiting if Cira ever holds a key
  for more than one company.

## Alternatives considered

- **Cira as an OIDC provider, apps add "Sign in with Cira".** Standard, and
  better for an app that wants its own session. It is also a much larger ask
  of the app author, and it does not help an agent call at all, which is half
  the point. Worth doing later; not instead.
- **Forwarding the person's own credentials.** Cira would have to hold them.
  Rejected on the vault rule.
- **An unsigned `x-cira-user` header, trusted because only Cira can reach the
  app.** True today - Cloud Run only accepts Cira's token - but it makes the
  app's security depend on a network property it cannot check, and it breaks
  the moment an app is reachable another way. Rejected.

## Order of work

1. This document reviewed, and the questions above answered in writing.
2. Signing, JWKS and rotation, with tests for expiry, audience and the
   inbound-strip rule.
3. The per-app setting, off by default, and the retry-once behaviour for a
   capability that was refused.
4. Documentation with the verification snippet in the four languages Cira
   already detects, because the feature is only as real as its adoption cost.
