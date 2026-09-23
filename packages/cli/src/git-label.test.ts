import { describe, expect, it } from "vitest";
import { formatLabel } from "./git-label.js";

describe("formatLabel", () => {
  it("says the commit, its subject, and whether there was uncommitted work", () => {
    expect(formatLabel("3f9a1c2", "Stats", false)).toBe("3f9a1c2 Stats");
    expect(formatLabel("3f9a1c2", "Stats", true)).toBe("3f9a1c2 Stats + changes");
  });

  it("keeps to one short line the server will take", () => {
    const label = formatLabel("3f9a1c2", `A\tlong\n${"word ".repeat(60)}`, true);
    expect(label.length).toBeLessThanOrEqual(120);
    expect(label).not.toMatch(/[\t\n]/);
    expect(label.endsWith("... + changes")).toBe(true);
  });
});
