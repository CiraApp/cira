import { describe, expect, it } from "vitest";
import { checkInvite, inviteExpiry, type InviteRecord } from "./invite-rules";

const NOW = new Date("2026-09-15T12:00:00Z");

function invite(over: Partial<InviteRecord> = {}): InviteRecord {
  return {
    email: "dana@acme.com",
    role: "member",
    acceptedAt: null,
    expiresAt: new Date("2026-09-20T12:00:00Z"),
    ...over,
  };
}

describe("checkInvite", () => {
  it("accepts the named person", () => {
    expect(
      checkInvite({ invite: invite(), viewerEmail: "dana@acme.com", now: NOW }).ok,
    ).toBe(true);
  });

  it("ignores case and surrounding space in either address", () => {
    expect(
      checkInvite({
        invite: invite({ email: "  Dana@Acme.com " }),
        viewerEmail: "dana@acme.com",
        now: NOW,
      }).ok,
    ).toBe(true);
  });

  it("refuses a forwarded link opened by someone else", () => {
    const v = checkInvite({
      invite: invite(),
      viewerEmail: "someone@else.com",
      now: NOW,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("wrong-account");
      expect(v.message).toContain("dana@acme.com");
    }
  });

  it("refuses an invite that has already been used", () => {
    const v = checkInvite({
      invite: invite({ acceptedAt: new Date("2026-09-14T00:00:00Z") }),
      viewerEmail: "dana@acme.com",
      now: NOW,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("used");
  });

  it("refuses an expired invite, including exactly at the boundary", () => {
    for (const expiresAt of [
      new Date("2026-09-14T12:00:00Z"),
      new Date("2026-09-15T12:00:00Z"),
    ]) {
      const v = checkInvite({
        invite: invite({ expiresAt }),
        viewerEmail: "dana@acme.com",
        now: NOW,
      });
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.code).toBe("expired");
    }
  });

  it("checks use before expiry, so a used invite never reads as merely expired", () => {
    const v = checkInvite({
      invite: invite({
        acceptedAt: new Date("2026-09-10T00:00:00Z"),
        expiresAt: new Date("2026-09-11T00:00:00Z"),
      }),
      viewerEmail: "dana@acme.com",
      now: NOW,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("used");
  });

  it("every refusal explains itself", () => {
    const cases: InviteRecord[] = [
      invite({ acceptedAt: NOW }),
      invite({ expiresAt: new Date("2020-01-01") }),
      invite({ email: "other@acme.com" }),
    ];
    for (const rec of cases) {
      const v = checkInvite({ invite: rec, viewerEmail: "dana@acme.com", now: NOW });
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.message.length).toBeGreaterThan(10);
    }
  });
});

describe("inviteExpiry", () => {
  it("is a week out", () => {
    expect(inviteExpiry(NOW).toISOString()).toBe("2026-09-22T12:00:00.000Z");
  });
});
