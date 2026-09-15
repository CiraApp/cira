import { describe, expect, it } from "vitest";
import { checkStaleness, DEPLOY_PATIENCE_MS } from "./deployment-staleness";

const NOW = new Date("2026-09-15T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("checkStaleness", () => {
  it("leaves a finished deploy alone, however old", () => {
    for (const status of ["live", "failed", "removed"] as const) {
      expect(
        checkStaleness({ status, createdAt: ago(365 * 24 * 3600 * 1000) }, NOW).action,
      ).toBe("settled");
    }
  });

  it("asks the provider while a young deploy is still plausible", () => {
    for (const status of ["queued", "building", "deploying"] as const) {
      expect(checkStaleness({ status, createdAt: ago(60_000) }, NOW).action).toBe(
        "ask-provider",
      );
    }
  });

  it("declares an abandoned deploy failed rather than leaving it spinning", () => {
    const v = checkStaleness(
      { status: "building", createdAt: ago(DEPLOY_PATIENCE_MS + 1000) },
      NOW,
    );
    expect(v.action).toBe("declare-failed");
    if (v.action === "declare-failed") expect(v.reason.length).toBeGreaterThan(10);
  });

  it("is still patient exactly at the boundary", () => {
    expect(
      checkStaleness({ status: "building", createdAt: ago(DEPLOY_PATIENCE_MS) }, NOW)
        .action,
    ).toBe("ask-provider");
  });

  it("never declares a finished deploy failed, even one that finished long ago", () => {
    expect(
      checkStaleness({ status: "live", createdAt: ago(DEPLOY_PATIENCE_MS * 100) }, NOW)
        .action,
    ).toBe("settled");
  });
});
