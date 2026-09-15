import { describe, expect, it } from "vitest";
import type { RepoSummary } from "@cira/extract";
import { keepGrounded } from "./capability-grounding";

/**
 * The analyzer's own output is a model's opinion. These cover the checks that
 * turn an opinion into something safe to register - above all, that a
 * capability cannot exist without a route behind it.
 */

const summary: RepoSummary = {
  framework: "nextjs",
  packageName: "revenue-app",
  dependencies: [],
  routes: [
    {
      path: "/api/revenue",
      methods: ["GET"],
      file: "app/api/revenue/route.ts",
      dynamic: false,
      doc: null,
      excerpt: "",
    },
    {
      path: "/api/refunds",
      methods: ["POST"],
      file: "app/api/refunds/route.ts",
      dynamic: false,
      doc: null,
      excerpt: "",
    },
  ],
  functions: [],
  shapes: [],
  notes: [],
};

const objectSchema = JSON.stringify({ type: "object", properties: {}, required: [] });

const candidate = (over: Partial<Record<string, unknown>> = {}) => ({
  name: "getRevenue",
  description: "Revenue for a date range.",
  method: "GET" as const,
  path: "/api/revenue",
  inputSchema: objectSchema,
  outputSchema: "",
  risk: "read" as const,
  confidence: 0.9,
  reasoning: "reads revenue",
  ...over,
});

describe("keepGrounded", () => {
  it("keeps a capability that points at a real route", () => {
    const kept = keepGrounded([candidate()], summary);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.name).toBe("getRevenue");
    expect(kept[0]?.outputSchema).toBeNull();
  });

  it("drops a capability whose route does not exist", () => {
    // The failure mode this whole check exists for: a plausible-sounding
    // operation with nothing behind it.
    expect(keepGrounded([candidate({ path: "/api/invented" })], summary)).toEqual([]);
  });

  it("drops a capability whose route does not answer that method", () => {
    expect(keepGrounded([candidate({ method: "POST" })], summary)).toEqual([]);
    expect(
      keepGrounded([candidate({ path: "/api/refunds", method: "GET" })], summary),
    ).toEqual([]);
  });

  it("refuses a target that tries to leave the app", () => {
    for (const path of ["https://evil.test/x", "//evil.test/x", "/api/../admin"]) {
      expect(keepGrounded([candidate({ path })], summary), path).toEqual([]);
    }
  });

  it("refuses a name that could not be addressed", () => {
    expect(keepGrounded([candidate({ name: "get revenue" })], summary)).toEqual([]);
  });

  it("keeps only the first of two capabilities claiming one name", () => {
    const kept = keepGrounded(
      [candidate({ description: "first" }), candidate({ description: "second" })],
      summary,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.description).toBe("first");
  });

  it("drops a capability whose input schema is not a usable object schema", () => {
    for (const inputSchema of ["", "not json", "[]", '{"type":"string"}', "null"]) {
      expect(keepGrounded([candidate({ inputSchema })], summary), inputSchema).toEqual(
        [],
      );
    }
  });

  it("parses an output schema when there is one, and tolerates rubbish", () => {
    const withOutput = keepGrounded(
      [candidate({ outputSchema: JSON.stringify({ type: "object" }) })],
      summary,
    );
    expect(withOutput[0]?.outputSchema).toEqual({ type: "object" });

    const bad = keepGrounded([candidate({ outputSchema: "{" })], summary);
    expect(bad[0]?.outputSchema).toBeNull();
  });

  it("clamps a confidence the model reported out of range", () => {
    expect(keepGrounded([candidate({ confidence: 4 })], summary)[0]?.confidence).toBe(1);
    expect(keepGrounded([candidate({ confidence: -1 })], summary)[0]?.confidence).toBe(0);
  });

  it("returns nothing when the app serves no routes at all", () => {
    expect(keepGrounded([candidate()], { ...summary, routes: [] })).toEqual([]);
  });
});
