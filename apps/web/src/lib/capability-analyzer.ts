import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { RepoSummary } from "@cira/extract";
import { analysis, keepGrounded, type AnalysisResult } from "@/lib/capability-grounding";

/**
 * Turn a repository's shape into candidate capabilities.
 *
 * One model call, one schema, and then deterministic checks. The spec is
 * explicit that this should not become a multi-agent code-analysis system, and
 * the reason is worth keeping in view: the model's job here is judgement -
 * which of these endpoints is a business operation an employee would recognise
 * - and everything that has to be *correct* rather than merely sensible is
 * settled by code on either side of it, in lib/capability-grounding.
 */

const SYSTEM = `You are Cira's capability analyzer.

Cira lets a company's employees and their agents use internal software. You are
given a compact description of one internal app, recovered from its source. Your
job is to identify the operations an employee would recognise as something the
app DOES, and that an agent could usefully call on their behalf.

Include an operation only when all of these hold:
- It corresponds to one of the HTTP routes listed. Routes are the only things
  that can be invoked; an exported function that is not behind a route cannot be.
- It is meaningful in business terms: getRevenue, searchCustomer, getSpendByVendor,
  matchInvoice, getTicket, generateReport.
- Its inputs can be described from the code you were given.

Exclude, always:
- internal helpers, formatting, framework utilities, low-level database helpers
- authentication, health checks, webhooks, cron endpoints, file uploads
- anything named like a test fixture or a reset
- administrative operations that exist to manage the app rather than to do its work

Naming: a verb and a noun, camelCase, the way a developer would name the function.
Prefer getRevenue to revenueGet and to handleRevenueRequest.

Risk:
- read: returns information and changes nothing.
- write: creates or updates something a person could undo.
- destructive: deletes, cancels, refunds, sends money or messages outside the
  company, or anything else that cannot simply be undone. When unsure between
  write and destructive, choose destructive.

Confidence is your own, 0 to 1. Use below 0.75 when you are inferring the
operation's meaning from a name rather than reading it from the code.

Input schemas: read the route body for query parameters, path parameters and
body fields. A zod schema beside the route is the best evidence there is; use it.
Describe each property. Mark a property required only when the route would fail
without it.

Summary: one sentence, at most 90 characters, saying what the app is for in the
words a colleague would use - "Invoices, revenue and the monthly close." Not a
list of its routes, not marketing, no trailing thoughts about the stack. Write
it even when there are no capabilities worth exposing, because the app still
appears in the gallery and still has to say what it is.

Never invent a route. Every path you return must appear verbatim in the routes
you were given, with the method you name listed for it. If an app has no
capabilities worth exposing, return an empty list - that is a good answer.`;

export async function analyzeCapabilities(
  summary: RepoSummary,
  options: { appName: string },
): Promise<AnalysisResult> {
  // Nothing addressable means nothing to expose, and no reason to spend a call
  // finding that out.
  if (summary.routes.length === 0) return { ok: true, summary: "", capabilities: [] };

  if (process.env["ANTHROPIC_API_KEY"] === undefined) {
    return { ok: false, error: "Cira is not configured to analyze capabilities." };
  }

  const client = new Anthropic();

  let parsed;
  try {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(analysis) },
      messages: [
        { role: "user", content: `App name: ${options.appName}\n\n${describe(summary)}` },
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
    capabilities: keepGrounded(parsed.capabilities, summary),
  };
}

/** The repository, as the model reads it. */
function describe(summary: RepoSummary): string {
  const lines: string[] = [];

  lines.push(`Framework: ${summary.framework}`);
  if (summary.packageName !== null) lines.push(`Package: ${summary.packageName}`);
  if (summary.dependencies.length > 0) {
    lines.push(`Dependencies: ${summary.dependencies.slice(0, 40).join(", ")}`);
  }

  lines.push("", "## Routes (the only valid targets)");
  for (const route of summary.routes) {
    lines.push("", `### ${route.methods.join(", ")} ${route.path}`);
    lines.push(`file: ${route.file}`);
    if (route.dynamic) lines.push("dynamic: this path contains a parameter segment");
    if (route.doc !== null) lines.push(`doc: ${route.doc}`);
    lines.push("```ts", route.excerpt, "```");
  }

  if (summary.functions.length > 0) {
    lines.push("", "## Exported functions (context only, never a target)");
    for (const fn of summary.functions) {
      const doc = fn.doc === null ? "" : ` - ${fn.doc}`;
      lines.push(`- ${fn.signature} (${fn.file})${doc}`);
    }
  }

  if (summary.shapes.length > 0) {
    lines.push("", "## Types and validation schemas");
    for (const shape of summary.shapes) {
      lines.push("", `### ${shape.name} (${shape.kind}, ${shape.file})`);
      lines.push("```ts", shape.text, "```");
    }
  }

  if (summary.notes.length > 0) {
    lines.push("", "## Notes", ...summary.notes.map((n) => `- ${n}`));
  }

  return lines.join("\n");
}
