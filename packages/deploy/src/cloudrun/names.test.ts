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
  it("joins a space and an app", () => {
    expect(serviceName("acme", "invoice-matcher")).toBe("acme-invoice-matcher");
  });

  it("lowercases and replaces what Cloud Run will not take", () => {
    expect(serviceName("Acme Corp", "Invoice_Matcher!")).toBe(
      "acme-corp-invoice-matcher",
    );
  });

  it("collapses runs of separators rather than leaving doubles", () => {
    expect(serviceName("a--b", "c___d")).toBe("a-b-c-d");
  });

  it("never starts with a digit", () => {
    // Cloud Run requires a leading letter, and a name it refuses fails at
    // create time rather than being trimmed for you.
    expect(serviceName("2024", "reports")).toMatch(/^[a-z]/);
  });

  it("stays inside the length limit", () => {
    const name = serviceName("a-very-long-company-name-indeed", "y".repeat(80));
    expect(name.length).toBeLessThanOrEqual(MAX_SERVICE_NAME);
    expect(name).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
  });

  it("is stable, so a redeploy lands on the same service", () => {
    // A name that changed per deploy would orphan the previous service and
    // leave the app answering on a URL nobody is watching.
    const once = serviceName("space", "z".repeat(90));
    const twice = serviceName("space", "z".repeat(90));
    expect(once).toBe(twice);
  });

  it("keeps two long names in one space apart", () => {
    const a = serviceName("space", `${"z".repeat(80)}-alpha`);
    const b = serviceName("space", `${"z".repeat(80)}-beta`);
    expect(a).not.toBe(b);
  });

  it("does not end on a hyphen after truncating", () => {
    for (let n = 55; n < 75; n += 1) {
      expect(serviceName("space", "a".repeat(n))).not.toMatch(/-$/);
    }
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
