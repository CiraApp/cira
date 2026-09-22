import { describe, expect, it } from "vitest";
import { checkRemoval, checkRoleChange } from "./membership-rules.js";

describe("checkRoleChange", () => {
  const change = (over: Partial<Parameters<typeof checkRoleChange>[0]>) =>
    checkRoleChange({
      actorRole: "admin",
      targetRole: "member",
      nextRole: "admin",
      owners: 1,
      self: false,
      ...over,
    }).ok;

  it("lets an admin make a member an admin, and back", () => {
    expect(change({})).toBe(true);
    expect(change({ targetRole: "admin", nextRole: "member" })).toBe(true);
  });

  it("keeps the owner role in owners' hands", () => {
    expect(change({ nextRole: "owner" })).toBe(false);
    expect(change({ targetRole: "owner", nextRole: "admin", owners: 2 })).toBe(false);
    expect(change({ actorRole: "owner", nextRole: "owner" })).toBe(true);
  });

  it("never leaves a space without an owner", () => {
    expect(
      change({
        actorRole: "owner",
        targetRole: "owner",
        nextRole: "admin",
        owners: 1,
        self: true,
      }),
    ).toBe(false);
    expect(
      change({
        actorRole: "owner",
        targetRole: "owner",
        nextRole: "admin",
        owners: 2,
        self: true,
      }),
    ).toBe(true);
  });

  it("refuses a plain member", () => {
    expect(change({ actorRole: "member" })).toBe(false);
  });

  it("lets an admin step down", () => {
    expect(
      change({ actorRole: "admin", targetRole: "admin", nextRole: "member", self: true }),
    ).toBe(true);
  });
});

describe("checkRemoval", () => {
  const remove = (over: Partial<Parameters<typeof checkRemoval>[0]>) =>
    checkRemoval({
      actorRole: "admin",
      targetRole: "member",
      owners: 1,
      self: false,
      ...over,
    });

  it("lets an admin remove members and admins", () => {
    expect(remove({}).ok).toBe(true);
    expect(remove({ targetRole: "admin" }).ok).toBe(true);
  });

  it("lets only an owner remove an owner, and never the last one", () => {
    expect(remove({ targetRole: "owner", owners: 2 }).ok).toBe(false);
    expect(remove({ actorRole: "owner", targetRole: "owner", owners: 2 }).ok).toBe(true);
    expect(remove({ actorRole: "owner", targetRole: "owner", owners: 1 }).ok).toBe(false);
  });

  it("lets anyone leave, except the last owner, who is told what to do instead", () => {
    expect(remove({ actorRole: "member", targetRole: "member", self: true }).ok).toBe(
      true,
    );
    const lastOwner = remove({
      actorRole: "owner",
      targetRole: "owner",
      owners: 1,
      self: true,
    });
    expect(lastOwner.ok).toBe(false);
    expect(!lastOwner.ok && lastOwner.reason).toMatch(/Make someone else an owner/);
  });

  it("refuses a member removing someone else", () => {
    expect(remove({ actorRole: "member" }).ok).toBe(false);
  });
});
