import { z } from "zod";
import {
  CAPABILITY_METHODS,
  isCapabilityName,
  isSafeTargetPath,
  type CapabilityMethod,
} from "@cira/core";

/**
 * The half of capability analysis that has to be correct rather than merely
 * sensible.
 *
 * Separated from the model call so it can be tested without one, and because
 * the two really are different jobs: the analyzer supplies judgement, this
 * decides what Cira is willing to store. Nothing here asks a model anything.
 *
 * It used to also check every path against a list of routes an extractor had
 * found, which was the strongest rule in the engine right up until it became
 * wrong. A served path is frequently assembled rather than written down - a
 * router mounted under a prefix from a constant - so the full path appears
 * nowhere in the source, and checking for it verbatim would reject exactly the
 * answers that took the most work to get right. What confirms a path now is
 * the deployed app, which is the only thing that knows for certain.
 */

const RISKS = ["read", "write"] as const;

const candidate = z.object({
  name: z
    .string()
    .describe("camelCase identifier, e.g. getRevenue. Unique within this app."),
  description: z
    .string()
    .describe("One sentence an employee would understand. No implementation detail."),
  method: z.enum(CAPABILITY_METHODS),
  path: z
    .string()
    .describe("The path as the app serves it, root-relative, e.g. /api/v1/revenue"),
  inputSchema: z
    .string()
    .describe(
      "JSON Schema for the input, serialised as a JSON string. An object schema, " +
        "with a property per query, path or body parameter the route reads. " +
        'Use {"type":"object","properties":{},"required":[]} when it takes none.',
    ),
  risk: z.enum(RISKS),
  probe: z
    .string()
    .describe(
      "For a read only: an example input safe to send, as a JSON object string. " +
        "Empty string for a write, which is never called to test it.",
    ),
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
  method: CapabilityMethod;
  path: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  risk: (typeof RISKS)[number];
  /** Example input, for reads. Used once, to ask the app whether this exists. */
  probe?: Record<string, unknown> | undefined;
}

export type AnalysisResult =
  | { ok: true; summary: string; capabilities: AnalyzedCapability[] }
  | { ok: false; error: string };

/**
 * Keep the candidates Cira could act on, and drop the rest.
 *
 * Not a check that the model told the truth - only the app can settle that.
 * This is the narrower question of whether a candidate is even well formed:
 * a name an agent can ask for, a path that cannot escape the app it belongs
 * to, and a schema that parses.
 */
export function keepGrounded(
  candidates: readonly z.infer<typeof candidate>[],
): AnalyzedCapability[] {
  const kept: AnalyzedCapability[] = [];
  const taken = new Set<string>();

  for (const item of candidates) {
    if (!isCapabilityName(item.name)) continue;
    if (taken.has(item.name)) continue;
    if (!isSafeTargetPath(item.path)) continue;

    const inputSchema = readSchema(item.inputSchema);
    if (inputSchema === null) continue;

    taken.add(item.name);
    kept.push({
      name: item.name,
      description: item.description.trim(),
      method: item.method,
      path: item.path,
      inputSchema,
      outputSchema: null,
      risk: item.risk,
      probe: item.risk === "read" ? (readSchema(item.probe) ?? {}) : undefined,
    });
  }

  return kept;
}

/** A JSON object, or null for anything that is not one. */
function readSchema(raw: string): Record<string, unknown> | null {
  if (raw.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
