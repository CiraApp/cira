import { describe, expect, it } from "vitest";
import { spoken } from "./spoken";

describe("spoken", () => {
  it("drops emphasis, list markers and headings", () => {
    expect(
      spoken(
        "# Delays\nThere is **one delayed shipment** right now:\n- **NW-1004**: Rotterdam to Milan",
      ),
    ).toBe("Delays There is one delayed shipment right now: NW-1004: Rotterdam to Milan");
  });

  it("keeps link text and code, and leaves snake_case alone", () => {
    expect(
      spoken("Run `cira deploy`, see [the docs](https://cira.dev/docs) for order_id."),
    ).toBe("Run cira deploy, see the docs for order_id.");
  });

  it("does not read code blocks out character by character", () => {
    expect(spoken("Try:\n```\nselect 1;\n```\nthen stop.")).toBe(
      "Try: (code) then stop.",
    );
  });
});
