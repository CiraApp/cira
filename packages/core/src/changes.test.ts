import { describe, expect, it } from "vitest";
import { CHANGE_KINDS, describeChange, type ChangeKind } from "./changes.js";

const KINDS = Object.keys(CHANGE_KINDS) as ChangeKind[];

describe("wording the record", () => {
  it("has a sentence for every kind of change, with or without a detail", () => {
    for (const kind of KINDS) {
      for (const detail of ["member to admin", null]) {
        const line = describeChange({
          kind,
          actor: "Ada",
          subject: "dana@acme.com",
          detail,
        });
        expect(line.length, kind).toBeGreaterThan(5);
        // Nothing may read as a template that lost its value.
        expect(line, kind).not.toContain("undefined");
        expect(line, kind).not.toContain("null");
        expect(line.trim(), kind).toBe(line);
      }
    }
  });

  it("names who it was done to in every line", () => {
    for (const kind of KINDS) {
      // The two that are about the company itself name the company instead.
      if (kind === "scim-token-made" || kind === "scim-stopped") continue;
      const line = describeChange({
        kind,
        actor: "Ada",
        subject: "Revenue Board",
        detail: null,
      });
      expect(line, kind).toContain("Revenue Board");
    }
  });

  it("says who did it, except where nobody but the person themselves did", () => {
    for (const kind of KINDS) {
      if (kind === "member-left" || kind === "member-joined") continue;
      const line = describeChange({
        kind,
        actor: "Ada",
        subject: "dana@acme.com",
        detail: null,
      });
      expect(line.startsWith("Ada "), kind).toBe(true);
    }
  });

  it("reads as a sentence for the changes people ask about", () => {
    expect(
      describeChange({
        kind: "role-changed",
        actor: "Ada",
        subject: "dana@acme.com",
        detail: "member to admin",
      }),
    ).toBe("Ada changed dana@acme.com from member to admin");

    expect(
      describeChange({
        kind: "access-revoked",
        actor: "Ada",
        subject: "everyone in the company",
        detail: "Env Probe",
      }),
    ).toBe("Ada took away everyone in the company's access to Env Probe");

    expect(
      describeChange({
        kind: "capability-enabled",
        actor: "Ada",
        subject: "Refund an order on Ledger",
        detail: null,
      }),
    ).toBe("Ada let agents run Refund an order on Ledger");

    // A company's own directory, not one of its admins.
    expect(
      describeChange({
        kind: "member-removed",
        actor: "your directory",
        subject: "dana@acme.com",
        detail: null,
      }),
    ).toBe("your directory removed dana@acme.com");
  });

  it("tells a new logo from one taken away", () => {
    const logo = (detail: string | null) =>
      describeChange({
        kind: "space-logo-changed",
        actor: "Ada",
        subject: "Acme",
        detail,
      });
    expect(logo(null)).toBe("Ada changed Acme's logo");
    expect(logo("removed")).toBe("Ada removed Acme's logo");
    expect(
      describeChange({
        kind: "space-logo-changed",
        actor: "Ada",
        subject: "Northwind Logistics",
        detail: null,
      }),
    ).toBe("Ada changed Northwind Logistics' logo");
  });
});
