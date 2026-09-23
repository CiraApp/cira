import { describe, expect, it } from "vitest";
import { unconfirmedNote } from "./unconfirmed-note";

describe("unconfirmedNote", () => {
  it("names a catch-all app as the reason when it is one", () => {
    expect(unconfirmedNote([{ unconfirmedBecause: "answers-everything" }])).toBe(
      "This app answers every address alike, so Cira could not tell by asking whether it serves these. They stay off until someone turns one on, and its first real call settles it.",
    );
  });

  it("says only a call would tell, for a route the app's answer could not settle", () => {
    expect(unconfirmedNote([{ unconfirmedBecause: "cannot-tell" }, {}])).toMatch(
      /^Cira could not tell from outside whether the app serves these; only calling one would\./,
    );
  });

  it("keeps to what they share when the reasons differ", () => {
    expect(
      unconfirmedNote([
        { unconfirmedBecause: "answers-everything" },
        { unconfirmedBecause: "cannot-tell" },
      ]),
    ).toMatch(
      /^Cira could not tell by asking whether the app serves these\. They stay off/,
    );
  });
});
