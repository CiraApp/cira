import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { noticeFor, planFor, readStatus } from "./billing-rules";
import { verifyWebhook } from "./billing";

/**
 * What a subscription's state means, and whether a webhook is really Stripe.
 * The first decides what a company may do; the second decides whether anyone
 * gets to say so.
 */
describe("what a subscription means", () => {
  it("keeps a company on its plan while a payment is merely late", () => {
    expect(planFor("active")).toBe("team");
    expect(planFor("trialing")).toBe("team");
    // Cira is where their software lives. A late card does not switch it off.
    expect(planFor("past_due")).toBe("team");
    expect(planFor("unpaid")).toBe("team");
    expect(noticeFor("past_due")?.tone).toBe("warn");
  });

  it("falls back to what a trial allows once a subscription is over", () => {
    expect(planFor("canceled")).toBe("trial");
    expect(planFor("incomplete_expired")).toBe("trial");
    expect(planFor(null)).toBe("trial");
    expect(noticeFor("canceled")).toMatchObject({ tone: "stop" });
    expect(noticeFor("canceled")?.message).toContain("Nothing has been deleted");
    expect(noticeFor("active")).toBeNull();
  });

  it("treats a status it has never heard of as no subscription at all", () => {
    expect(readStatus("scheduled_for_mars")).toBeNull();
    expect(readStatus(undefined)).toBeNull();
    expect(readStatus("active")).toBe("active");
  });
});

describe("verifyWebhook", () => {
  const secret = "whsec_test";
  const payload = '{"type":"customer.subscription.updated"}';
  const signed = (at: Date, body = payload, key = secret) => {
    const t = Math.floor(at.getTime() / 1000);
    const v1 = createHmac("sha256", key).update(`${t}.${body}`).digest("hex");
    return `t=${t},v1=${v1}`;
  };
  const now = new Date("2026-09-19T12:00:00Z");

  it("accepts what Stripe signed, just now", () => {
    expect(verifyWebhook({ payload, header: signed(now), secret, now })).toBe(true);
  });

  it("refuses another key, a changed body, a missing header, and an old one", () => {
    expect(
      verifyWebhook({
        payload,
        header: signed(now, payload, "whsec_other"),
        secret,
        now,
      }),
    ).toBe(false);
    expect(
      verifyWebhook({ payload: `${payload} `, header: signed(now), secret, now }),
    ).toBe(false);
    expect(verifyWebhook({ payload, header: null, secret, now })).toBe(false);
    expect(verifyWebhook({ payload, header: "nonsense", secret, now })).toBe(false);
    // Captured an hour ago and sent again.
    const old = new Date(now.getTime() - 3600_000);
    expect(verifyWebhook({ payload, header: signed(old), secret, now })).toBe(false);
  });
});
