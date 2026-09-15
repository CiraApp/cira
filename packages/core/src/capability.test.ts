import { describe, expect, it } from "vitest";
import {
  AUTO_ENABLE_CONFIDENCE,
  isCapabilityName,
  isSafeTargetPath,
  publicationFor,
  reconcileCapabilities,
} from "./capability.js";

describe("publicationFor", () => {
  it("auto-enables only a confident read", () => {
    expect(publicationFor({ risk: "read", confidence: 0.9 })).toEqual({
      enabled: true,
      reason: "auto",
    });
    expect(publicationFor({ risk: "read", confidence: AUTO_ENABLE_CONFIDENCE })).toEqual({
      enabled: true,
      reason: "auto",
    });
  });

  it("holds back a read it is unsure about", () => {
    expect(publicationFor({ risk: "read", confidence: 0.5 })).toEqual({
      enabled: false,
      reason: "review",
    });
  });

  it("never auto-enables a write, however confident", () => {
    expect(publicationFor({ risk: "write", confidence: 1 })).toEqual({
      enabled: false,
      reason: "review",
    });
  });

  it("leaves anything destructive off", () => {
    expect(publicationFor({ risk: "destructive", confidence: 1 })).toEqual({
      enabled: false,
      reason: "destructive",
    });
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
