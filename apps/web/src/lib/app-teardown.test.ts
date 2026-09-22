import { describe, expect, it } from "vitest";
import { servicesOf } from "./app-teardown";

describe("servicesOf", () => {
  it("names every service an app has run under, once each", () => {
    // Renamed before names were kept stable: two services, both still up.
    expect(
      servicesOf([
        { provider: "cloudrun", providerDeploymentId: "b-3:acme-books-0000app1:t3" },
        { provider: "cloudrun", providerDeploymentId: "b-2:acme-ledger-0000app1:t2" },
        { provider: "cloudrun", providerDeploymentId: "b-1:acme-ledger-0000app1:t1" },
      ]),
    ).toEqual(["acme-books-0000app1", "acme-ledger-0000app1"]);
  });

  it("skips what the provider before Cloud Run left, and what it cannot read", () => {
    expect(
      servicesOf([
        { provider: "vercel", providerDeploymentId: "dpl_123" },
        { provider: "cloudrun", providerDeploymentId: "not a handle" },
      ]),
    ).toEqual([]);
  });
});
