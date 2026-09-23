import { describe, expect, it } from "vitest";
import {
  consoleAffordance,
  formFor,
  readForm,
  readJsonInput,
  type FormField,
} from "./capability-console.js";

describe("consoleAffordance", () => {
  // Every reach against both values of enabled: the whole table.
  it.each([
    ["callable", true, "run"],
    ["callable", false, "off"],
    ["refused", true, "refused"],
    ["refused", false, "refused"],
    ["pending", true, "pending"],
    ["pending", false, "pending"],
    ["unconfirmed", true, "run"],
    ["unconfirmed", false, "off"],
  ] as const)("%s and enabled=%s offers %s", (reach, enabled, kind) => {
    expect(consoleAffordance({ reach, enabled }).kind).toBe(kind);
  });

  it("says who can switch a capability on, and why the others cannot run", () => {
    expect(consoleAffordance({ reach: "callable", enabled: false })).toEqual({
      kind: "off",
      reason: "Turned off. An app admin can enable it.",
    });
    expect(consoleAffordance({ reach: "pending", enabled: true })).toEqual({
      kind: "pending",
      reason: "Not yet confirmed against the running app.",
    });
  });

  // Not "pending": nothing more will come from asking, so the page says what
  // will settle it and who can do that.
  it("says an unconfirmed one waits for a person, not for Cira", () => {
    expect(consoleAffordance({ reach: "unconfirmed", enabled: false })).toEqual({
      kind: "off",
      reason:
        "The app could not confirm this one without being called. An app admin can turn it on; the first real call settles it.",
    });
  });
});

describe("formFor", () => {
  const schema = {
    type: "object",
    properties: {
      order_id: { type: "string", description: "The order." },
      start: { type: "string", format: "date" },
      status: { type: "string", enum: ["paid", "pending", "refunded"] },
      limit: { type: "integer" },
      ratio: { type: "number" },
      urgent: { type: "boolean" },
      tags: { type: "array", items: { type: "string" } },
      nickname: { type: ["string", "null"] },
    },
    required: ["order_id", "start"],
  };

  it("draws each kind of scalar as its own kind of field", () => {
    const form = formFor(schema);
    expect(form.kind).toBe("fields");
    if (form.kind !== "fields") return;

    const kinds = Object.fromEntries(form.fields.map((f) => [f.name, f.kind]));
    expect(kinds).toEqual({
      order_id: "text",
      start: "date",
      status: "select",
      limit: "number",
      ratio: "number",
      urgent: "checkbox",
      tags: "list",
      nickname: "text",
    });
    expect(form.fields.find((f) => f.name === "order_id")).toMatchObject({
      required: true,
      description: "The order.",
    });
    expect(form.fields.find((f) => f.name === "limit")).toMatchObject({
      integer: true,
      required: false,
    });
    expect(form.fields.find((f) => f.name === "status")).toMatchObject({
      options: ["paid", "pending", "refunded"],
      valueType: "string",
    });
  });

  it("fills fields from the example input, then the schema's default", () => {
    const form = formFor(
      {
        type: "object",
        properties: {
          order_id: { type: "string" },
          limit: { type: "integer", default: 20 },
          urgent: { type: "boolean" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
      { order_id: "ord_1001", urgent: true, tags: ["a", "b"] },
    );
    expect(form.kind === "fields" && form.fields.map((f) => f.initial)).toEqual([
      "ord_1001",
      "20",
      true,
      ["a", "b"],
    ]);
  });

  it("draws an input with no fields as a form with nothing to fill", () => {
    expect(formFor({ type: "object", properties: {} })).toEqual({
      kind: "fields",
      fields: [],
    });
    expect(formFor({ type: "object" })).toEqual({ kind: "fields", fields: [] });
  });

  /**
   * All or nothing: a form that drew the easy fields and dropped the hard one
   * would send an input missing something the schema asked for.
   */
  it.each([
    [
      "a nested object",
      { type: "object", properties: { address: { type: "object", properties: {} } } },
    ],
    [
      "an array of objects",
      {
        type: "object",
        properties: { lines: { type: "array", items: { type: "object" } } },
      },
    ],
    [
      "a union",
      {
        type: "object",
        properties: { id: { oneOf: [{ type: "string" }, { type: "number" }] } },
      },
    ],
    ["a reference", { type: "object", properties: { id: { $ref: "#/defs/id" } } }],
    ["a field with no type", { type: "object", properties: { anything: {} } }],
    ["an input that is not an object", { type: "array", items: { type: "string" } }],
  ])("falls back to JSON for the whole input on %s", (_what, unmappable) => {
    const form = formFor(unmappable as Record<string, unknown>, { keep: "me" });
    expect(form.kind).toBe("json");
    expect(form.kind === "json" && JSON.parse(form.initial)).toEqual({ keep: "me" });
  });

  it("falls back to JSON even when the other fields were easy", () => {
    const form = formFor({
      type: "object",
      properties: { order_id: { type: "string" }, address: { type: "object" } },
    });
    expect(form.kind).toBe("json");
  });
});

describe("readForm", () => {
  const fields = (
    formFor({
      type: "object",
      properties: {
        order_id: { type: "string" },
        limit: { type: "integer" },
        ratio: { type: "number" },
        status: { type: "string", enum: ["paid", "refunded"] },
        size: { type: "integer", enum: [10, 20] },
        urgent: { type: "boolean" },
        tags: { type: "array", items: { type: "integer" } },
      },
      required: ["order_id"],
    }) as { kind: "fields"; fields: FormField[] }
  ).fields;

  it("types every value the way the schema asks", () => {
    expect(
      readForm(fields, {
        order_id: " ord_1 ",
        limit: "5",
        ratio: "0.5",
        status: "paid",
        size: "20",
        urgent: true,
        tags: ["1", " 2 ", ""],
      }),
    ).toEqual({
      ok: true,
      input: {
        order_id: "ord_1",
        limit: 5,
        ratio: 0.5,
        status: "paid",
        size: 20,
        urgent: true,
        tags: [1, 2],
      },
    });
  });

  // An empty string sent to an app is a value, and usually the wrong one.
  it("leaves out optional fields left empty, and an unticked optional box", () => {
    expect(
      readForm(fields, { order_id: "ord_1", limit: "", urgent: false, tags: [] }),
    ).toEqual({
      ok: true,
      input: { order_id: "ord_1" },
    });
  });

  it("says which field is wrong", () => {
    expect(readForm(fields, { order_id: "" })).toMatchObject({
      ok: false,
      field: "order_id",
    });
    expect(readForm(fields, { order_id: "x", limit: "1.5" })).toMatchObject({
      ok: false,
      field: "limit",
    });
    expect(readForm(fields, { order_id: "x", tags: ["one"] })).toMatchObject({
      ok: false,
      field: "tags",
    });
  });
});

describe("readJsonInput", () => {
  it("takes an object, and nothing else", () => {
    expect(readJsonInput('{"a":1}')).toEqual({ ok: true, input: { a: 1 } });
    expect(readJsonInput("")).toEqual({ ok: true, input: {} });
    expect(readJsonInput("[1]").ok).toBe(false);
    expect(readJsonInput("{nope").ok).toBe(false);
  });
});
