import type { JsonSchema } from "@cira/core";

/**
 * Validate a capability's input against its own schema.
 *
 * A deliberately small subset of JSON Schema: objects, primitives, arrays,
 * enums and `required`. That is the whole of what the analyzer is asked to
 * produce, and a validator that covers exactly what can be produced is easier
 * to trust than a general one that covers things nothing generates.
 *
 * Unknown properties are dropped rather than refused. The schema is inferred
 * from code, so it is allowed to be incomplete; an agent passing something
 * extra should not fail, but the app should never see a field its capability
 * did not describe.
 */

export type Validation =
  { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

export function validateInput(schema: JsonSchema, input: unknown): Validation {
  const given = input === undefined || input === null ? {} : input;

  if (typeof given !== "object" || Array.isArray(given)) {
    return { ok: false, error: "input must be an object." };
  }

  const properties = asRecord(schema["properties"]) ?? {};
  const required = asStringArray(schema["required"]) ?? [];
  const source = given as Record<string, unknown>;
  const value: Record<string, unknown> = {};

  for (const name of required) {
    if (source[name] === undefined || source[name] === null) {
      return { ok: false, error: `${name} is required.` };
    }
  }

  for (const [name, raw] of Object.entries(properties)) {
    const supplied = source[name];
    if (supplied === undefined || supplied === null) continue;

    const property = asRecord(raw);
    if (property === undefined) {
      value[name] = supplied;
      continue;
    }

    const problem = check(name, property, supplied);
    if (problem !== null) return { ok: false, error: problem };

    value[name] = supplied;
  }

  return { ok: true, value };
}

/** Null when the value fits, otherwise the sentence to hand back. */
function check(
  name: string,
  schema: Record<string, unknown>,
  value: unknown,
): string | null {
  const allowed = schema["enum"];
  if (Array.isArray(allowed) && !allowed.includes(value)) {
    return `${name} must be one of: ${allowed.map((v) => String(v)).join(", ")}.`;
  }

  const type = schema["type"];
  if (typeof type !== "string") return null;

  switch (type) {
    case "string":
      return typeof value === "string" ? null : `${name} must be a string.`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `${name} must be a number.`;
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? null
        : `${name} must be a whole number.`;
    case "boolean":
      return typeof value === "boolean" ? null : `${name} must be true or false.`;
    case "array": {
      if (!Array.isArray(value)) return `${name} must be a list.`;
      const items = asRecord(schema["items"]);
      if (items === undefined) return null;
      for (const [index, entry] of value.entries()) {
        const problem = check(`${name}[${index}]`, items, entry);
        if (problem !== null) return problem;
      }
      return null;
    }
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? null
        : `${name} must be an object.`;
    default:
      // A type this validator does not model is not a reason to refuse a call;
      // the app is the final judge of its own input.
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : undefined;
}
