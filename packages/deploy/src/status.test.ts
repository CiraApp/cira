import { describe, expect, it } from "vitest";
import { isTerminal } from "./status.js";

describe("isTerminal", () => {
  it("knows when to stop polling", () => {
    expect(isTerminal("live")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("removed")).toBe(true);
    expect(isTerminal("building")).toBe(false);
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("deploying")).toBe(false);
  });
});
