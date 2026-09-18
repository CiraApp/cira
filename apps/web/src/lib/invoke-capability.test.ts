import { describe, expect, it } from "vitest";
import { speaksForNobody } from "./invoke-capability";

/**
 * The guard on recording a refusal from a real call. A 401 only says the app
 * is shut to Cira while Cira asked as nobody; once a request carries someone's
 * identity, the same 401 is about that one person.
 */
describe("speaksForNobody", () => {
  const anonymous = {
    accept: "application/json",
    "content-type": "application/json",
    "content-length": "2",
    "x-serverless-authorization": "Bearer id-token",
    "x-cira-capability": "lockOrder",
  };

  it("accepts exactly what Cira sends today", () => {
    expect(speaksForNobody(anonymous)).toBe(true);
  });

  it("does not care how a header is capitalised", () => {
    expect(speaksForNobody({ Accept: "application/json" })).toBe(true);
  });

  it("stops at the credentials anyone would think to check for", () => {
    expect(speaksForNobody({ ...anonymous, authorization: "Bearer user" })).toBe(false);
    expect(speaksForNobody({ ...anonymous, cookie: "session=abc" })).toBe(false);
  });

  /**
   * The reason it is an allow-list. Whatever change first passes a person's
   * identity to an app will use a header nobody here can name in advance, and
   * it has to switch recording off without anyone remembering to.
   */
  it("stops at a header nobody has decided about yet", () => {
    expect(speaksForNobody({ ...anonymous, "x-cira-user": "usr_123" })).toBe(false);
  });
});
