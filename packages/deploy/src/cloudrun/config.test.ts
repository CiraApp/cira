import { describe, expect, it } from "vitest";
import { cloudRunConfig } from "./config.js";

const complete = {
  GCP_PROJECT_ID: "project-6fad049b",
  GCP_PROJECT_NUMBER: "129464643726",
  GCP_REGION: "us-central1",
  GCP_SOURCE_BUCKET: "project-6fad049b-cira-sources",
  GCP_ARTIFACT_REPO: "cira-apps",
  GCP_SERVICE_ACCOUNT_EMAIL: "cira-deployer@project-6fad049b.iam.gserviceaccount.com",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel",
};

describe("cloudRunConfig", () => {
  it("reads every setting", () => {
    expect(cloudRunConfig(complete)).toEqual({
      projectId: "project-6fad049b",
      projectNumber: "129464643726",
      region: "us-central1",
      sourceBucket: "project-6fad049b-cira-sources",
      artifactRepo: "cira-apps",
      serviceAccountEmail: "cira-deployer@project-6fad049b.iam.gserviceaccount.com",
      poolId: "vercel",
      providerId: "vercel",
    });
  });

  it("trims what someone pasted with a space on the end", () => {
    expect(cloudRunConfig({ ...complete, GCP_REGION: "  us-central1 " }).region).toBe(
      "us-central1",
    );
  });

  // The point of the collected list: setting up Google is an eight variable
  // job, and finding that out one failed deploy at a time is the bad version.
  it("names every missing setting at once", () => {
    const { GCP_REGION, GCP_ARTIFACT_REPO, ...rest } = complete;
    void GCP_REGION;
    void GCP_ARTIFACT_REPO;

    expect(() => cloudRunConfig(rest)).toThrow(
      "Deployments are not configured. Set GCP_REGION, GCP_ARTIFACT_REPO.",
    );
  });

  it("treats an empty value as unset", () => {
    expect(() => cloudRunConfig({ ...complete, GCP_SOURCE_BUCKET: "   " })).toThrow(
      "GCP_SOURCE_BUCKET",
    );
  });
});
