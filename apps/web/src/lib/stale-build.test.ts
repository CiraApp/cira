import { describe, expect, it } from "vitest";
import { isStaleBuild } from "./stale-build";

describe("isStaleBuild", () => {
  it("recognises a server action the new version no longer has", () => {
    expect(
      isStaleBuild(
        new Error(
          'Server Action "0098e3f193347050708c5908c33554d93276fda096" was not found on the server.',
        ),
      ),
    ).toBe(true);
    expect(isStaleBuild({ name: "UnrecognizedActionError", message: "" })).toBe(true);
  });

  it("leaves real failures alone", () => {
    expect(isStaleBuild(new Error('relation "apps" does not exist'))).toBe(false);
    expect(isStaleBuild(new Error("Not found"))).toBe(false);
  });
});
