import type { CapabilityReach, JsonSchema } from "./capability.js";

/**
 * The capability console, as rules: what a person may do with a capability, and
 * the form its input schema becomes.
 *
 * The console is the deterministic way into an app's capabilities - for someone
 * who knows what they want and wants to see the literal input before anything
 * runs. Everything it decides lives here as plain functions over plain records,
 * so the rules are tested without a browser, and so the server and the page
 * cannot come to different conclusions about the same capability.
 */

/**
 * What the console offers for one capability.
 *
 * Only a switched-on capability the app confirmed, or one a person turned on
 * although the app could not confirm it, can run. Everything else still shows the
 * capability - hiding it would make an app look as if it does less than it
 * does - with the reason in words. A refusal is stated plainly and is not
 * dressed up as an error: the route is real and the app is doing exactly what
 * it was built to do.
 */
export type ConsoleAffordance =
  | { kind: "run" }
  | { kind: "off"; reason: string }
  | { kind: "refused"; reason: string }
  | { kind: "pending"; reason: string };

export function consoleAffordance(capability: {
  reach: CapabilityReach;
  enabled: boolean;
}): ConsoleAffordance {
  switch (capability.reach) {
    case "refused":
      return {
        kind: "refused",
        reason:
          "The app turns Cira away from this one: it asks whoever calls it to sign in, and Cira cannot sign in on anyone's behalf.",
      };
    case "pending":
      return { kind: "pending", reason: "Not yet confirmed against the running app." };
    case "callable":
      return capability.enabled
        ? { kind: "run" }
        : { kind: "off", reason: "Turned off. An app admin can enable it." };
    // `enabled` here is already the folded answer: on only when a person
    // turned it on. Running it by hand is the first real call, which is what
    // settles whether the route is there.
    case "unconfirmed":
      return capability.enabled
        ? { kind: "run" }
        : {
            kind: "off",
            reason:
              "The app could not confirm this one without being called. An app admin can turn it on; the first real call settles it.",
          };
  }
}

/** One input, as the form draws it. */
export type FormField = {
  name: string;
  required: boolean;
  /** The schema's own words about the field, when it has any. */
  description: string | null;
} & (
  | { kind: "text"; initial: string }
  | { kind: "date"; initial: string }
  | { kind: "select"; options: string[]; valueType: Scalar; initial: string }
  | { kind: "number"; integer: boolean; initial: string }
  | { kind: "checkbox"; initial: boolean }
  | { kind: "list"; item: Scalar; initial: string[] }
);

type Scalar = "string" | "number" | "integer" | "boolean";

/**
 * The form for a capability's input: a field per property, or - when any part
 * of the schema cannot be drawn cleanly - one JSON editor for the whole input.
 *
 * All or nothing on purpose. A form that drew the easy fields and quietly
 * dropped a nested object would send an input missing something the schema
 * asked for, and look complete while doing it.
 */
export type CapabilityForm =
  | { kind: "fields"; fields: FormField[] }
  | { kind: "json"; initial: string; reason: string };

/**
 * Map a JSON Schema to a form, prefilled from the capability's example input.
 *
 * Strings become text, `format: date` a date picker, an `enum` a select;
 * numbers and integers become number inputs; booleans a checkbox; an array of
 * scalars a list. Anything else - a nested object, a union, a reference, an
 * array of objects - sends the whole input to the JSON editor.
 */
export function formFor(
  schema: JsonSchema,
  example?: Record<string, unknown> | null,
): CapabilityForm {
  const given = example ?? {};
  const asJson = (reason: string): CapabilityForm => ({
    kind: "json",
    initial: JSON.stringify(given, null, 2),
    reason,
  });

  const type = schema["type"];
  if (type !== undefined && type !== "object")
    return asJson("The input is not an object.");

  const properties = schema["properties"];
  if (properties === undefined) return { kind: "fields", fields: [] };
  if (!isRecord(properties)) return asJson("The input's fields are not described.");

  const required = new Set(
    Array.isArray(schema["required"])
      ? schema["required"].filter((r): r is string => typeof r === "string")
      : [],
  );

  const fields: FormField[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (!isRecord(raw)) return asJson(`${name} has no description of its own.`);
    const field = fieldFor(name, raw, required.has(name), given[name]);
    if (field === null) return asJson(`${name} is more than a form field can hold.`);
    fields.push(field);
  }

  return { kind: "fields", fields };
}

function fieldFor(
  name: string,
  schema: Record<string, unknown>,
  required: boolean,
  example: unknown,
): FormField | null {
  if (hasAny(schema, ["oneOf", "anyOf", "allOf", "$ref", "not"])) return null;

  const type = scalarType(schema["type"]);
  const description =
    typeof schema["description"] === "string" && schema["description"].trim() !== ""
      ? schema["description"].trim()
      : null;
  const start = example !== undefined ? example : schema["default"];
  const base = { name, required, description };

  const choices = schema["enum"];
  if (Array.isArray(choices)) {
    const valueType = type ?? inferScalar(choices);
    if (valueType === null || valueType === "boolean") return null;
    if (!choices.every((c) => matches(c, valueType))) return null;
    return {
      ...base,
      kind: "select",
      options: choices.map(String),
      valueType,
      initial: start === undefined ? "" : String(start),
    };
  }

  switch (type) {
    case "string":
      return schema["format"] === "date"
        ? { ...base, kind: "date", initial: typeof start === "string" ? start : "" }
        : { ...base, kind: "text", initial: typeof start === "string" ? start : "" };
    case "number":
    case "integer":
      return {
        ...base,
        kind: "number",
        integer: type === "integer",
        initial: typeof start === "number" ? String(start) : "",
      };
    case "boolean":
      return { ...base, kind: "checkbox", initial: start === true };
    case null:
      break;
  }

  if (schema["type"] === "array" && isRecord(schema["items"])) {
    const items = schema["items"];
    if (hasAny(items, ["enum", "oneOf", "anyOf", "allOf", "$ref"])) return null;
    const item = scalarType(items["type"]);
    if (item === null) return null;
    return {
      ...base,
      kind: "list",
      item,
      initial: Array.isArray(start)
        ? start.filter((v) => matches(v, item)).map(String)
        : [],
    };
  }

  return null;
}

/**
 * The input a filled-in form describes, or which field is wrong and why.
 *
 * Values arrive as the browser holds them - text, a checkbox's state, a list
 * of strings - and leave typed as the schema asks. An optional field left
 * empty is left out rather than sent as an empty string, which an app would
 * read as a value. A checkbox is sent when it is ticked or when the schema
 * requires it: an unticked optional box is "not set", not "false".
 *
 * This is a convenience for the person filling the form. The server validates
 * the result independently and trusts none of it.
 */
export function readForm(
  fields: readonly FormField[],
  values: Record<string, string | boolean | string[] | undefined>,
):
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; field: string; error: string } {
  const input: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = values[field.name];

    if (field.kind === "checkbox") {
      const ticked = raw === true;
      if (ticked || field.required) input[field.name] = ticked;
      continue;
    }

    if (field.kind === "list") {
      const items = (Array.isArray(raw) ? raw : [])
        .map((v) => v.trim())
        .filter((v) => v !== "");
      if (items.length === 0) {
        if (field.required)
          return { ok: false, field: field.name, error: "Add at least one." };
        continue;
      }
      const typed: unknown[] = [];
      for (const item of items) {
        const value = coerce(item, field.item);
        if (value === undefined) {
          return {
            ok: false,
            field: field.name,
            error: `"${item}" is not ${article(field.item)}.`,
          };
        }
        typed.push(value);
      }
      input[field.name] = typed;
      continue;
    }

    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") {
      if (field.required) return { ok: false, field: field.name, error: "Required." };
      continue;
    }

    const type: Scalar =
      field.kind === "number"
        ? field.integer
          ? "integer"
          : "number"
        : field.kind === "select"
          ? field.valueType
          : "string";
    const value = coerce(text, type);
    if (value === undefined) {
      return { ok: false, field: field.name, error: `That is not ${article(type)}.` };
    }
    input[field.name] = value;
  }

  return { ok: true, input };
}

/**
 * The input a JSON editor holds, or why it cannot be one. Only an object is an
 * input; a capability's input is always a set of named values.
 */
export function readJsonInput(
  text: string,
): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  if (text.trim() === "") return { ok: true, input: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not valid JSON." };
  }
  if (!isRecord(parsed)) return { ok: false, error: "The input must be a JSON object." };
  return { ok: true, input: parsed };
}

function coerce(text: string, type: Scalar): unknown {
  switch (type) {
    case "string":
      return text;
    case "boolean":
      return text === "true" ? true : text === "false" ? false : undefined;
    case "number": {
      const n = Number(text);
      return Number.isFinite(n) ? n : undefined;
    }
    case "integer": {
      const n = Number(text);
      return Number.isInteger(n) ? n : undefined;
    }
  }
}

function article(type: Scalar): string {
  return type === "integer"
    ? "a whole number"
    : type === "number"
      ? "a number"
      : `a ${type}`;
}

/** A schema's type when it is one scalar, allowing `["string", "null"]`. */
function scalarType(type: unknown): Scalar | null {
  const types = Array.isArray(type) ? type.filter((t) => t !== "null") : [type];
  if (types.length !== 1) return null;
  const [only] = types;
  return only === "string" ||
    only === "number" ||
    only === "integer" ||
    only === "boolean"
    ? only
    : null;
}

function inferScalar(values: unknown[]): Scalar | null {
  if (values.length === 0) return null;
  if (values.every((v) => typeof v === "string")) return "string";
  if (values.every((v) => Number.isInteger(v))) return "integer";
  if (values.every((v) => typeof v === "number")) return "number";
  return null;
}

function matches(value: unknown, type: Scalar): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
  }
}

function hasAny(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => record[key] !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
