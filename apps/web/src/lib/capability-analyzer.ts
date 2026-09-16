import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { analysis, keepGrounded, type AnalysisResult } from "@/lib/capability-grounding";

/**
 * Read a repository and say what the app does.
 *
 * One model call over the source itself. It used to be one model call over a
 * summary an extractor had built first - which routes existed, which functions
 * mattered, which 900 characters of each were worth keeping - and every one of
 * those judgements was Next.js-shaped. A Python service came out empty, which
 * is the whole reason this changed: the apps worth deploying are not all
 * frontends, and an analyzer that only understands one framework only ever
 * sees one kind of app.
 *
 * Reading the code is simpler as well as broader. Nothing between here and the
 * model knows what language anything is written in.
 *
 * The model's job is still judgement - which operations an employee would
 * recognise, what to call them, whether they only look or also change
 * something. What has to be *correct* is settled elsewhere: well-formedness by
 * lib/capability-grounding, and existence by asking the deployed app, in
 * lib/capability-verify.
 */

const SYSTEM = `You are Cira's capability analyzer.

Cira lets a company's employees and their agents use internal software. You are
given the full source of one internal app. Find the operations an employee
would recognise as something the app DOES, and that an agent could usefully
call on their behalf.

## What counts

Include an operation only when all of these hold:
- The app serves it over HTTP at a path you can establish from the source.
- It is meaningful in business terms: getRevenue, searchCustomer, matchInvoice,
  getTicket, generateReport.
- Its inputs can be described from the code.

Exclude:
- signing in, signing out, session refresh, password reset, token exchange
- health, readiness, liveness, metrics, telemetry ingest
- webhooks, cron, queue and task endpoints, which machines call, not people
- migrations, seeds, fixtures, anything named like a test or a reset
- serving a stored file, redirects to one, and link-preview or unfurl pages
- endpoints that hold a connection open rather than answering once: streams,
  server-sent events, websockets. There is no single request to describe.

Include, even though they look close to the above:
- reading the current user's own profile, when it carries business data such as
  balances, quotas, entitlements or standing. That is not authentication.
- generating an artifact on demand - a rendered report, chart or image. That is
  work the app does, not a file it stores.

## Paths must be the ones the app actually serves

A route's declared path is usually not the path it is served at. Routers are
mounted under prefixes, often from a constant or a setting defined elsewhere,
and applications mount other applications. Follow the mounting all the way to
the root.

  @router.post("/beats/{id}/save")  in a router included with
  prefix=API_PREFIX  where  API_PREFIX = "/api/v1"
  is served at  /api/v1/beats/{id}/save

Where there is no mount to follow - a framework whose top-level calls are the
declaration, or a router nothing wraps - the declared path is the served path.
Absent evidence of a prefix, there is no prefix.

Two shapes need saying explicitly.

**Paths from file layout.** Some frameworks put the path in the directory
structure. Take the routing root - \`app/\`, \`pages/\`, \`routes/\`, ignoring a
leading \`src/\` - and read the directories under it. The file that holds the
handler is a leaf and contributes nothing: \`app/api/invoices/[id]/void/route.ts\`
is served at \`/api/invoices/{id}/void\`. A directory in parentheses is a grouping
and contributes nothing to the path. A segment that swallows the rest of the
path - \`[...rest]\`, \`*rest\`, \`<path:rest>\` - is one parameter, \`{rest}\`. Only
files that handle requests count; files that render a page are the app's own
interface, not an operation an agent can call.

**Method packed into the pattern.** Some routers take the method and the path as
one string - \`mux.HandleFunc("POST /inventory/{sku}", ...)\`. Split it: the
method is POST and the path is \`/inventory/{sku}\`.

One declaration can be several operations. A route registered for more than one
method, or a handler file exporting more than one, is one capability per method
- they do different things and are graded differently.

Write path parameters as \`{name}\`, whatever the framework's own notation is -
\`:handle\`, \`[id]\` and \`<int:id>\` all become \`{handle}\`, \`{id}\`, \`{id}\`. Where a
parameter is only part of a segment, keep the rest of the segment as it is:
\`/share/rank/{handle}/{lane}.png\`.

Only route declarations and their mounts count. Source is full of path-shaped
strings that are not routes this app serves: URLs built for a front end, links
embedded in HTML or email, paths hardcoded into response bodies, and paths in
tests. A test is good evidence of what a served path looks like, because it
calls the real one - but the route declaration is what decides.

## Read or write

Two grades, and only one thing turns on them: a \`read\` is made available to
agents automatically, and a \`write\` stays switched off until a person turns it
on.

- \`read\` - the method is GET or HEAD, and nothing in the handler changes stored
  state.
- \`write\` - everything else.

Start from the method. A GET or HEAD is a \`read\` unless you can see it change
something: inserting or updating a row, enqueueing a job, sending a message,
reserving or consuming a quota, writing a file, advancing a counter. Name that
change in the description when you find it.

Two questions, in this order.

**Can you see the handler?** If not, it is a \`read\`. A stub, a comment, a body
you were not given, or a call into code that is not in the source are all
normal, and a lookup that reads like a lookup is a \`read\`. Grade on what the
source shows, never on what you suspect it might cache or log. Most GETs end
here.

**If you can see it write, would the caller notice?** A GET that stores
something only to avoid doing the same work twice - filling in a derived column
the first time it is needed, caching a computed report, recording that something
was last seen - is still a \`read\`. Nobody asked for that write and nobody can
tell it happened from the response. A GET that creates or reserves something the
caller then holds, sees, or can come back to is a \`write\`.

Judge that by the caller of this request. A write that some other screen
displays later, but that this response does not reflect and this caller did not
ask for, is not a change to this operation.

Computing a response is not a change either. Rendering a report, a chart or an
image on demand is a \`read\`, however expensive.

Where a GET only writes when a non-default parameter asks it to, grade it on its
default behaviour and say what the parameter does in the description.

Do not try to grade how dangerous a write is. The description says what it does,
and a person reads it before enabling anything.

## Fields

- \`name\`: a verb and a noun, camelCase, as a developer would name the function.
  Prefer \`getRevenue\` to \`revenueGet\` or \`handleRevenueRequest\`. Names must be
  unique within the app; where two operations would collide, qualify the
  narrower one (\`listLanes\` and \`listAdminLanes\`).
- \`description\`: one sentence a colleague would understand. This is what a
  person reads before allowing a write, so say what it actually does to what.
- \`method\`, \`path\`: as served.
- \`risk\`: \`read\` or \`write\`.
- \`inputSchema\`: JSON Schema object covering query, path and body parameters. A
  typed model or validation schema beside the route is the best evidence there
  is; use it, including its defaults, enums and bounds. Failing that, take what
  the handler reads from the request, and what its callers send in tests. If the
  body is untyped and nothing reveals its shape, give the parameters you are
  sure of and leave the rest open rather than dropping the operation - "inputs
  can be described" means the operation is describable, not that a schema
  already exists. An operation whose input you cannot describe at all is
  \`{ "type": "object", "properties": {}, "required": [] }\`; do not invent
  properties to fill it.
- \`probe\`: for a \`read\` only, an example input safe to send, used to check the
  operation exists. Give path parameters syntactically valid values that will
  not match real data. Omit for a write - writes are never called to test them.

## Summary

One sentence, at most 90 characters, saying what the app is for in the words a
colleague would use - "Invoices, revenue and the monthly close." Not a list of
routes, not marketing. Write it even when there are no capabilities.

## Rules

Never invent a path. If an app has no capabilities worth exposing, return an
empty list - that is a good answer.`;

/**
 * Enough for a large app's worth of capabilities and their schemas. Wave, the
 * biggest thing measured, produces 51 of them.
 */
const MAX_TOKENS = 32_000;

export async function analyzeCapabilities(
  source: string,
  options: { appName: string },
): Promise<AnalysisResult> {
  // Nothing to read means nothing to expose, and no reason to spend a call
  // finding that out.
  if (source.trim() === "") return { ok: true, summary: "", capabilities: [] };

  if (process.env["ANTHROPIC_API_KEY"] === undefined) {
    return { ok: false, error: "Cira is not configured to analyze capabilities." };
  }

  const client = new Anthropic();

  let parsed;
  try {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(analysis) },
      messages: [
        {
          role: "user",
          content: `App name: ${options.appName}\n\nSource:\n\n${source}`,
        },
      ],
    });
    parsed = response.parsed_output;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Capability analysis failed.",
    };
  }

  if (parsed === null || parsed === undefined) {
    return { ok: false, error: "Capability analysis returned nothing usable." };
  }

  return {
    ok: true,
    // Trimmed and capped here rather than trusted: the length is a request to a
    // model, and this column is rendered in a card that has one line for it.
    summary: parsed.summary.trim().slice(0, 140),
    capabilities: keepGrounded(parsed.capabilities),
  };
}
