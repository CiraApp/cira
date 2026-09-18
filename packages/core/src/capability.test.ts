import { describe, expect, it } from "vitest";
import {
  currentReach,
  isCapabilityName,
  isSafeTargetPath,
  publicationFor,
  reconcileCapabilities,
} from "./capability.js";

describe("publicationFor", () => {
  it("lets a read turn itself on", () => {
    expect(publicationFor({ risk: "read" })).toEqual({ enabled: true, reason: "auto" });
  });

  it("never auto-enables anything that changes something", () => {
    expect(publicationFor({ risk: "write" })).toEqual({
      enabled: false,
      reason: "review",
    });
  });

  /**
   * It used to weigh how sure the analyzer said it was. It no longer needs to:
   * a capability is not stored at all until the deployed app has answered for
   * the route, and an app confirming its own routes is better evidence than a
   * number the analyzer chose for itself.
   */
  it("depends on nothing but the grade", () => {
    expect(publicationFor({ risk: "read" })).toEqual(publicationFor({ risk: "read" }));
    expect(publicationFor({ risk: "write" })).toEqual(publicationFor({ risk: "write" }));
  });
});

describe("isSafeTargetPath", () => {
  it("accepts a root-relative path", () => {
    expect(isSafeTargetPath("/api/revenue")).toBe(true);
    expect(isSafeTargetPath("/api/customers/[id]")).toBe(true);
  });

  it("refuses anything that could leave the app", () => {
    for (const path of [
      "https://evil.test/steal",
      "//evil.test/steal",
      "/api/../../etc/passwd",
      "api/revenue",
      "/api/revenue?admin=1",
      "/api/revenue#x",
      "/api/rev enue",
      "/api\\revenue",
      "",
    ]) {
      expect(isSafeTargetPath(path), path).toBe(false);
    }
  });
});

describe("isCapabilityName", () => {
  it("accepts an identifier", () => {
    expect(isCapabilityName("getRevenue")).toBe(true);
    expect(isCapabilityName("get_revenue_2")).toBe(true);
  });

  it("refuses anything that would need escaping to be addressed", () => {
    for (const name of ["", "1get", "get revenue", "get-revenue", "get.revenue", "a"]) {
      expect(isCapabilityName(name), name).toBe(false);
    }
  });
});

describe("reconcileCapabilities", () => {
  const detected = (name: string, risk: "read" | "write", confidence = 0.9) => ({
    name,
    risk,
    confidence,
  });

  it("creates what is new, with the policy's default", () => {
    const plan = reconcileCapabilities([], [detected("getRevenue", "read")]);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]?.enabled).toBe(true);
    expect(plan.enabledCount).toBe(1);
  });

  it("removes a capability whose code has gone", () => {
    const plan = reconcileCapabilities(
      [{ id: "cap_1", name: "oldThing", enabled: true }],
      [detected("getRevenue", "read")],
    );
    expect(plan.remove).toEqual(["cap_1"]);
  });

  it("keeps a person's decision across a redeploy, rather than re-applying policy", () => {
    // Someone reviewed createRefund and turned it on. Detecting it again must
    // not switch it back off...
    const on = reconcileCapabilities(
      [{ id: "cap_1", name: "createRefund", enabled: true }],
      [detected("createRefund", "write")],
    );
    expect(on.update[0]?.enabled).toBe(true);
    expect(on.enabledCount).toBe(1);

    // ...and one they deliberately turned off must not come back on.
    const off = reconcileCapabilities(
      [{ id: "cap_2", name: "getRevenue", enabled: false }],
      [detected("getRevenue", "read")],
    );
    expect(off.update[0]?.enabled).toBe(false);
    expect(off.reviewCount).toBe(1);
  });

  it("describes a full replacement without losing track of anything", () => {
    const plan = reconcileCapabilities(
      [
        { id: "cap_keep", name: "getRevenue", enabled: true },
        { id: "cap_drop", name: "removedThing", enabled: true },
      ],
      [detected("getRevenue", "read"), detected("getSpendByVendor", "read")],
    );

    expect(plan.remove).toEqual(["cap_drop"]);
    expect(plan.update.map((u) => u.id)).toEqual(["cap_keep"]);
    expect(plan.create.map((c) => c.detected.name)).toEqual(["getSpendByVendor"]);
    expect(plan.enabledCount + plan.reviewCount).toBe(2);
  });
});

describe("currentReach", () => {
  const refused = (answeredBy: string | null) => ({
    reach: "refused" as const,
    answeredBy,
  });

  it("keeps a refusal from the build that is serving", () => {
    expect(currentReach(refused("dep_now"), "dep_now")).toBe("refused");
  });

  /**
   * The case this exists for. Somebody saw "Refused", let Cira in, and
   * redeployed; every route kept its path, so nothing else would have
   * reset them, and the page would have gone on saying they were shut.
   */
  it("asks again once a newer build is serving", () => {
    expect(currentReach(refused("dep_before"), "dep_now")).toBe("pending");
  });

  it("treats a refusal from an unknown build as history", () => {
    expect(currentReach(refused(null), "dep_now")).toBe("pending");
  });

  // Nothing is serving mid-build or after a failed one, so there is nobody to
  // ask, and "Checking" would sit there for ever.
  it("lets the last answer stand while nothing is serving", () => {
    expect(currentReach(refused("dep_before"), null)).toBe("refused");
  });

  // A working capability must not blink off between a deploy going live and
  // the app being asked about it.
  it("never ages a yes", () => {
    expect(currentReach({ reach: "callable", answeredBy: "dep_before" }, "dep_now")).toBe(
      "callable",
    );
  });
});
