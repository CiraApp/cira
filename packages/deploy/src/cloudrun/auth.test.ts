import { describe, expect, it } from "vitest";
import { audienceFor, subjectFor } from "./auth";

const config = {
  projectNumber: "129464643726",
  serviceAccountEmail: "cira-deployer@p.iam.gserviceaccount.com",
  poolId: "vercel",
  providerId: "vercel",
};

describe("audienceFor", () => {
  it("names the pool provider Google will check the token against", () => {
    expect(audienceFor(config)).toBe(
      "//iam.googleapis.com/projects/129464643726" +
        "/locations/global/workloadIdentityPools/vercel/providers/vercel",
    );
  });

  it("is addressed by project number, not project id", () => {
    // Google's federation endpoints take the number. Passing the id fails as a
    // flat permission denial that names neither.
    expect(audienceFor(config)).toContain("/projects/129464643726");
    expect(audienceFor({ ...config, projectNumber: "1" })).not.toBe(audienceFor(config));
  });

  it("is always global, because pools are not regional", () => {
    expect(audienceFor(config)).toContain("/locations/global/");
  });
});

describe("subjectFor", () => {
  it("is the exact principal a binding has to match", () => {
    expect(
      subjectFor({ team: "aumitshiv", project: "cira", environment: "production" }),
    ).toBe("owner:aumitshiv:project:cira:environment:production");
  });

  it("separates the environments", () => {
    // Preview deployments present a different subject from production, so each
    // environment needs its own binding or it silently cannot deploy.
    const base = { team: "aumitshiv", project: "cira" } as const;
    const all = (["production", "preview", "development"] as const).map((environment) =>
      subjectFor({ ...base, environment }),
    );
    expect(new Set(all).size).toBe(3);
  });

  it("separates projects in one team", () => {
    const base = { team: "aumitshiv", environment: "production" } as const;
    expect(subjectFor({ ...base, project: "cira" })).not.toBe(
      subjectFor({ ...base, project: "other" }),
    );
  });
});
