import { describe, expect, it } from "vitest";
import {
  MAX_SERVICE_NAME,
  deploymentHandle,
  imageRef,
  parseHandle,
  serviceName,
  servicePath,
  sourceObject,
} from "./names";

describe("serviceName", () => {
  const id = "app_0123456789abcdef0123456789abcdef";

  it("joins a space and an app, and says which app", () => {
    expect(
      serviceName({ spaceSlug: "acme", appSlug: "invoice-matcher", appId: id }),
    ).toBe("acme-invoice-matcher-89abcdef");
  });

  it("lowercases and replaces what Cloud Run will not take", () => {
    expect(
      serviceName({ spaceSlug: "Acme Corp", appSlug: "Invoice_Matcher!", appId: id }),
    ).toBe("acme-corp-invoice-matcher-89abcdef");
  });

  /**
   * The reason the id is there at all. Cloud Run names allow only letters,
   * digits and hyphens, so two slugs joined by a hyphen cannot be taken apart:
   * these two are different apps in different companies that would otherwise
   * share one service, and whichever deployed second would take over the
   * other's image and environment.
   */
  it("keeps two companies off the same service", () => {
    const first = serviceName({
      spaceSlug: "acme-corp",
      appSlug: "ledger",
      appId: "app_1111111111111111111111111111aaaa",
    });
    const second = serviceName({
      spaceSlug: "acme",
      appSlug: "corp-ledger",
      appId: "app_2222222222222222222222222222bbbb",
    });

    expect(first).not.toBe(second);
  });

  it("is the same every time, so a redeploy finds its own service", () => {
    const args = { spaceSlug: "acme", appSlug: "ledger", appId: id };
    expect(serviceName(args)).toBe(serviceName(args));
  });

  it("starts with a letter, whatever the slug started with", () => {
    expect(serviceName({ spaceSlug: "9to5", appSlug: "app", appId: id })).toMatch(
      /^[a-z]/,
    );
  });

  it("fits, and still identifies the app, when the slugs do not", () => {
    const name = serviceName({
      spaceSlug: "a".repeat(40),
      appSlug: "b".repeat(40),
      appId: id,
    });
    expect(name.length).toBeLessThanOrEqual(MAX_SERVICE_NAME);
    expect(name.endsWith("-89abcdef")).toBe(true);
    expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("refuses an id it cannot tell apart", () => {
    expect(() =>
      serviceName({ spaceSlug: "acme", appSlug: "ledger", appId: "app_1" }),
    ).toThrow("usable app id");
  });
});

describe("imageRef", () => {
  it("addresses Artifact Registry by region, project and source", () => {
    expect(
      imageRef({
        region: "us-central1",
        projectId: "cira-prod",
        repository: "apps",
        service: "acme-ledger",
        tag: "src_123",
      }),
    ).toBe("us-central1-docker.pkg.dev/cira-prod/apps/acme-ledger:src_123");
  });

  it("tags by source, so a rollback has something to point at", () => {
    const base = {
      region: "us-central1",
      projectId: "p",
      repository: "apps",
      service: "s",
    };
    expect(imageRef({ ...base, tag: "one" })).not.toBe(imageRef({ ...base, tag: "two" }));
  });
});

describe("deploymentHandle", () => {
  it("round-trips the three things a Cloud Run deploy is", () => {
    const handle = deploymentHandle({
      buildId: "9f1c-4a",
      service: "acme-ledger",
      tag: "src_123",
    });
    expect(handle).toBe("9f1c-4a:acme-ledger:src_123");
    expect(parseHandle(handle)).toEqual({
      buildId: "9f1c-4a",
      service: "acme-ledger",
      tag: "src_123",
    });
  });

  // Every deployment row written before this provider existed holds a bare
  // Vercel id, and those rows are still in the table.
  it("says so when it is handed another provider's id", () => {
    expect(() => parseHandle("dpl_9RaYvCa")).toThrow("not made by Cloud Run");
    expect(() => parseHandle("a:b:c:d")).toThrow("not made by Cloud Run");
    expect(() => parseHandle("a::c")).toThrow("not made by Cloud Run");
  });
});

describe("sourceObject", () => {
  it("files an upload under whoever uploaded it", () => {
    expect(sourceObject("usr_abc", "src_def")).toBe("sources/usr_abc/src_def.tar.gz");
  });

  it("keeps colons out of the name", () => {
    // A colon in an object name has to be escaped in every URL that addresses
    // it. The `.tar.gz` extension is fine and stays.
    const object = sourceObject("usr_abc", "src_def");
    expect(object).not.toContain(":");
    expect(object).toMatch(/\.tar\.gz$/);
  });

  // The check that matters: these two halves are pasted into a URL path, and a
  // traversal in either would address an object the caller was never given.
  it("refuses anything that is not an id", () => {
    expect(() => sourceObject("../other", "src_def")).toThrow("user id");
    expect(() => sourceObject("usr_abc", "a/b")).toThrow("source id");
    expect(() => sourceObject("usr_abc", "")).toThrow("source id");
  });
});

describe("servicePath", () => {
  it("is the name the Cloud Run API addresses", () => {
    expect(servicePath({ projectId: "p", region: "us-central1", service: "s" })).toBe(
      "projects/p/locations/us-central1/services/s",
    );
  });
});
