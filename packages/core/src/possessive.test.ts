import { describe, expect, it } from "vitest";
import { possessive } from "./possessive.js";

describe("possessive", () => {
  it("adds 's, or only the apostrophe after an s", () => {
    expect(possessive("Dana")).toBe("Dana's");
    expect(possessive("Operations")).toBe("Operations'");
    expect(possessive("GLOBEX INDUSTRIES")).toBe("GLOBEX INDUSTRIES'");
  });

  it("writes the apostrophe it is given", () => {
    expect(possessive("Theo", "’")).toBe("Theo’s");
  });
});
