import { describe, expect, it } from "vitest";

/**
 * What an agent is handed as a result. Readable when it is small; whole when
 * it can be; and, when it cannot, plainly cut with a reason, rather than a
 * megabyte of one app's answer spent from somebody's context window.
 */
describe("forAnAgent", () => {
  it("pretty-prints a small result", async () => {
    const { forAnAgent } = await import("./mcp");
    expect(forAnAgent({ total: 1 })).toBe('{\n  "total": 1\n}');
    expect(forAnAgent(null)).toBe("null");
  });

  it("drops the indentation before it drops any data", async () => {
    const { forAnAgent, MAX_RESULT_CHARS } = await import("./mcp");
    const rows = Array.from({ length: 3000 }, (_, i) => ({ id: i, name: `row ${i}` }));
    const compact = JSON.stringify(rows);
    expect(JSON.stringify(rows, null, 2).length).toBeGreaterThan(MAX_RESULT_CHARS);
    expect(compact.length).toBeLessThan(MAX_RESULT_CHARS);
    expect(forAnAgent(rows)).toBe(compact);
  });

  it("cuts what will not fit, and says so", async () => {
    const { forAnAgent, MAX_RESULT_CHARS } = await import("./mcp");
    const huge = { blob: "x".repeat(MAX_RESULT_CHARS * 2) };
    const out = forAnAgent(huge);
    expect(out.length).toBeLessThan(MAX_RESULT_CHARS + 400);
    expect(out).toContain("[Cut off:");
    expect(out).toContain("Ask for less");
  });
});
