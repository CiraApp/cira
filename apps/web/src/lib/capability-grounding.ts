import { z } from "zod";
import type { RepoSummary } from "@cira/extract";
import { isCapabilityName, isSafeTargetPath } from "@cira/core";

/**
 * The half of capability analysis that has to be correct rather than merely
 * sensible.
 *
 * Separated from the model call so it can be tested without one, and because
 * the two really are different jobs: the analyzer supplies judgement, this
 * decides what Cira is willing to act on. Nothing here asks a model anything.
 */

const RISKS = ["read", "write", "destructive"] as const;

const candidate = z.object({
  name: z
    .string()
    .describe("camelCase identifier, e.g. getRevenue. Unique within this app."),
  description: z
    .string()
    .describe("One sentence an employee would understand. No implementation detail."),
  method: z.enum(["GET", "POST"]),
  path: z
    .string()
    .describe("The route path exactly as given in the routes list, e.g. /api/revenue"),
  inputSchema: z
    .string()
    .describe(
      "JSON Schema for the input, serialised as a JSON string. An object schema, " +
        "with a property per query parameter or body field the route reads. " +
        'Use {"type":"object","properties":{},"required":[]} when it takes none.',
    ),
  outputSchema: z
    .string()
    .describe(
      "JSON Schema for the response, serialised as a JSON string, or an empty string.",
    ),
  risk: z.enum(RISKS),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().describe("One line, internal only. Why this is a capability."),
});

export const analysis = z.object({
  /**
   * What the app is, in one line, for the gallery and the app's own page.
   *
   * Asked for in the same call that finds the capabilities because the model
   * has already read the repository by then: a second call to summarise what
   * it just analysed would cost a second call and know strictly less.
   */
  summary: z.string(),
  capabilities: z.array(candidate),
});

export interface AnalyzedCapability {
  name: string;
  description: string;
  method: "GET" | "POST";
  path: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  risk: (typeof RISKS)[number];
  confidence: number;
}

/**
 * Drop every candidate that is not anchored in the extracted repository.
 *
 * Exported so the rule can be tested without a model in the loop, because it
 * is the rule that makes the whole engine safe to turn on.
 */
export function keepGrounded(
  candidates: readonly z.infer<typeof candidate>[],
  summary: RepoSummary,
): AnalyzedCapability[] {
  const routes = new Map(summary.routes.map((route) => [route.path, route]));
  const kept: AnalyzedCapability[] = [];
  const taken = new Set<string>();

  for (const item of candidates) {
    if (!isCapabilityName(item.name)) continue;
    if (taken.has(item.name)) continue;
    if (!isSafeTargetPath(item.path)) continue;

    // The target must be a route this app was found to serve, answering the
    // method named. Anything else is a capability with nowhere to go.
    const route = routes.get(item.path);
    if (route === undefined) continue;
    if (!(route.methods as readonly string[]).includes(item.method)) continue;

    const inputSchema = readSchema(item.inputSchema);
    if (inputSchema === null) continue;

    kept.push({
      name: item.name,
      description: item.description.trim().slice(0, 400),
      method: item.method,
      path: item.path,
      inputSchema,
      outputSchema: readSchema(item.outputSchema),
      risk: item.risk,
      confidence: Math.min(1, Math.max(0, item.confidence)),
    });
    taken.add(item.name);
  }

  return kept;
}

/**
 * Schemas travel as strings because a model asked for free-form nested JSON
 * returns something shaped like a schema rather than a schema. Parsed here,
 * and anything that is not an object schema is refused rather than repaired.
 */
function readSchema(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  if (text === "") return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const schema = value as Record<string, unknown>;
    return schema["type"] === "object" ? schema : null;
  } catch {
    return null;
  }
}

export type AnalysisResult =
  | { ok: true; summary: string; capabilities: AnalyzedCapability[] }
  | { ok: false; error: string };
