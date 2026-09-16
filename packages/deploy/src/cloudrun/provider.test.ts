import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDeploymentInput } from "@cira/core";
import type { GoogleTokens } from "./auth.js";
import type { CloudRunConfig } from "./config.js";
import { CloudRunProvider } from "./provider.js";
import { imageTag } from "./source.js";

const config = {
  projectId: "proj",
  projectNumber: "1",
  region: "us-central1",
  sourceBucket: "cira-sources",
  artifactRepo: "cira-apps",
  serviceAccountEmail: "deployer@proj.iam.gserviceaccount.com",
  poolId: "vercel",
  providerId: "vercel",
} satisfies CloudRunConfig;

const tokens = {
  accessToken: async () => "ya29.fake",
  identityToken: async (audience: string) => `id-for-${audience}`,
} as unknown as GoogleTokens;

const SOURCE_URI = "gs://cira-sources/sources/usr_1/src_2.tar.gz#17000001";
const TAG = imageTag(SOURCE_URI);
const IMAGE = `us-central1-docker.pkg.dev/proj/cira-apps/acme-ledger:${TAG}`;

const input: AppDeploymentInput = {
  appId: "app_1",
  spaceSlug: "acme",
  appSlug: "ledger",
  framework: "python",
  source: { uri: SOURCE_URI, size: 4096 },
  env: { DATABASE_URL: "postgres://user:hunter2@db/app", PORT: "8080" },
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}

let calls: Call[];

/** Answer each request by the first matching rule, in order. */
function serve(rules: Array<[RegExp, (method: string) => unknown | Response]>): void {
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const raw = init?.body;
    calls.push({
      method,
      url,
      body: typeof raw === "string" ? JSON.parse(raw) : undefined,
    });

    for (const [pattern, answer] of rules) {
      if (!pattern.test(url)) continue;
      const result = answer(method);
      return Promise.resolve(
        result instanceof Response
          ? result
          : new Response(JSON.stringify(result), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
}

const provider = (): CloudRunProvider => new CloudRunProvider(config, tokens);

const building = { id: "b-1", status: "WORKING" };
const built = { id: "b-1", status: "SUCCESS", logsBucket: "gs://cira-sources" };

/** A service as Cloud Run describes one that is up and serving. */
function serviceAt(image: string, extra: Record<string, unknown> = {}): unknown {
  return {
    uri: "https://acme-ledger-abc-uc.a.run.app",
    latestReadyRevision: "acme-ledger-00001",
    latestCreatedRevision: "acme-ledger-00001",
    terminalCondition: { type: "Ready", state: "TRUE" },
    template: {
      labels: {},
      containers: [
        {
          image,
          env: [{ name: "DATABASE_URL", value: "postgres://user:hunter2@db/app" }],
        },
      ],
    },
    ...extra,
  };
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deploy", () => {
  it("starts a build from the uploaded archive and pins its generation", async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);

    const result = await provider().deploy(input);

    const build = calls.find((c) => c.url.includes("cloudbuild"))?.body as Record<
      string,
      never
    >;
    expect(build["source"]).toEqual({
      storageSource: {
        bucket: "cira-sources",
        object: "sources/usr_1/src_2.tar.gz",
        generation: "17000001",
      },
    });

    // Both halves of the deploy have to be findable from the one string Cira
    // gets to store.
    expect(result.providerDeploymentId).toBe(`b-1:acme-ledger:${TAG}`);
    expect(result.status).toBe("building");
  });

  /**
   * The invariant docs/secrets.md exists for. A build request and its logs are
   * readable by anyone with access to the project, so nothing about the app's
   * environment may appear in one - not as a substitution, not in a step's
   * arguments, not anywhere.
   */
  it("puts no environment value anywhere near the build", async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);

    await provider().deploy(input);

    const build = JSON.stringify(calls.find((c) => c.url.includes("cloudbuild"))?.body);
    expect(build).not.toContain("hunter2");
    expect(build).not.toContain("DATABASE_URL");
  });

  it("carries the environment to the service instead", async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);

    await provider().deploy(input);

    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toContain("allowMissing=true");
    const body = patch?.body as {
      template: { containers: Array<{ env: Array<{ name: string; value: string }> }> };
    };
    // PORT is gone: Cloud Run sets it itself and rejects a service that tries
    // to, and it is in a great many `.env` files because it is how you run the
    // thing locally.
    expect(body.template.containers[0]?.env).toEqual([
      { name: "DATABASE_URL", value: "postgres://user:hunter2@db/app" },
    ]);
  });

  it("drops the names Cloud Run reserves rather than failing the deploy", async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);

    await provider().deploy({
      ...input,
      env: { PORT: "3000", K_SERVICE: "mine", KEEP: "yes" },
    });

    const patch = calls.find((c) => c.method === "PATCH");
    const body = patch?.body as {
      template: { containers: Array<{ env: Array<{ name: string }> }> };
    };
    expect(body.template.containers[0]?.env).toEqual([{ name: "KEEP", value: "yes" }]);
  });

  /**
   * The reason the image is not swapped here. Pointing a live service at an
   * image that is still being built replaces a working revision with one that
   * cannot start, so a redeploy would take the app down for the length of its
   * own build.
   */
  it("leaves a running app on the image it is already serving", async () => {
    const old = "us-central1-docker.pkg.dev/proj/cira-apps/acme-ledger:older";
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? serviceAt(old) : {})],
    ]);

    const result = await provider().deploy(input);

    const patch = calls.find((c) => c.method === "PATCH");
    const body = patch?.body as { template: { containers: Array<{ image: string }> } };
    expect(body.template.containers[0]?.image).toBe(old);
    expect(result.url).toBe("https://acme-ledger-abc-uc.a.run.app");
  });

  it("points a brand new service at the image being built", async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);

    await provider().deploy(input);

    const patch = calls.find((c) => c.method === "PATCH");
    const body = patch?.body as { template: { containers: Array<{ image: string }> } };
    expect(body.template.containers[0]?.image).toBe(IMAGE);
  });

  /**
   * Not adding a binding is the whole access model: a Cloud Run service is
   * unreachable until `allUsers` is granted the invoker role, and Cira never
   * grants it. A test rather than a comment, because the failure is silent -
   * the app just quietly becomes public.
   */
  it("never writes an IAM policy", async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);

    await provider().deploy(input);
    expect(calls.some((c) => c.url.includes("setIamPolicy"))).toBe(false);
  });
});

describe("getStatus", () => {
  const handle = `b-1:acme-ledger:${TAG}`;

  it("does not touch the service while the build is running", async () => {
    serve([[/cloudbuild/, () => building]]);

    const result = await provider().getStatus(handle);

    expect(result.status).toBe("building");
    expect(calls.some((c) => c.url.includes("run.googleapis"))).toBe(false);
  });

  it("reports a failed build without inventing a URL", async () => {
    serve([[/cloudbuild/, () => ({ id: "b-1", status: "FAILURE" })]]);

    expect(await provider().getStatus(handle)).toEqual({
      providerDeploymentId: handle,
      status: "failed",
      url: null,
    });
  });

  it("rolls the built image out once, and keeps the environment", async () => {
    serve([
      [/cloudbuild/, () => built],
      [/run\.googleapis/, (m) => (m === "GET" ? serviceAt("older-image") : {})],
    ]);

    const result = await provider().getStatus(handle);

    const patch = calls.find((c) => c.method === "PATCH");
    const body = patch?.body as {
      template: {
        labels: Record<string, string>;
        containers: Array<{ image: string; env: Array<{ name: string; value: string }> }>;
      };
    };
    expect(body.template.containers[0]?.image).toBe(IMAGE);
    // Read back off the service, because the deploy that had it is long over.
    expect(body.template.containers[0]?.env).toEqual([
      { name: "DATABASE_URL", value: "postgres://user:hunter2@db/app" },
    ]);
    expect(body.template.labels["cira-build"]).toBe("b-1");
    expect(result.status).toBe("deploying");
  });

  it("does not roll the same build out twice", async () => {
    serve([
      [/cloudbuild/, () => built],
      [
        /run\.googleapis/,
        (m) =>
          m === "GET"
            ? serviceAt(IMAGE, {
                template: {
                  labels: { "cira-build": "b-1" },
                  containers: [{ image: IMAGE, env: [] }],
                },
              })
            : {},
      ],
    ]);

    const result = await provider().getStatus(handle);

    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(result).toEqual({
      providerDeploymentId: handle,
      status: "live",
      url: "https://acme-ledger-abc-uc.a.run.app",
    });
  });

  /**
   * `uri` is populated long before anything answers on it, so it cannot be the
   * signal. A container that never listens leaves the newest revision short of
   * ready while the condition still reads true from the one before it.
   */
  it("is not live merely because the service has a URL", async () => {
    serve([
      [/cloudbuild/, () => built],
      [
        /run\.googleapis/,
        () =>
          serviceAt(IMAGE, {
            latestReadyRevision: "acme-ledger-00001",
            latestCreatedRevision: "acme-ledger-00002",
            template: {
              labels: { "cira-build": "b-1" },
              containers: [{ image: IMAGE, env: [] }],
            },
          }),
      ],
    ]);

    const result = await provider().getStatus(handle);
    expect(result.status).toBe("deploying");
    expect(result.url).toBeNull();
  });

  it("reports a container that will not start as failed", async () => {
    serve([
      [/cloudbuild/, () => built],
      [
        /run\.googleapis/,
        () =>
          serviceAt(IMAGE, {
            terminalCondition: {
              type: "Ready",
              state: "FALSE",
              message: "container failed to listen on PORT",
            },
            template: {
              labels: { "cira-build": "b-1" },
              containers: [{ image: IMAGE, env: [] }],
            },
          }),
      ],
    ]);

    expect((await provider().getStatus(handle)).status).toBe("failed");
  });

  it("says removed when the app was deleted mid-build", async () => {
    serve([
      [/cloudbuild/, () => built],
      [/run\.googleapis/, () => new Response("", { status: 404 })],
    ]);

    expect((await provider().getStatus(handle)).status).toBe("removed");
  });

  it("refuses a deployment id from the provider Cira used to use", async () => {
    serve([]);
    await expect(provider().getStatus("dpl_9RaYvCa")).rejects.toThrow(
      "not made by Cloud Run",
    );
  });
});

describe("getLogs", () => {
  it("reads the build's own log out of the bucket", async () => {
    serve([
      [/cloudbuild/, () => built],
      [
        /storage\.googleapis/,
        () => new Response("FETCHSOURCE\nBUILD\nDONE\n", { status: 200 }),
      ],
    ]);

    const lines = await provider().getLogs(`b-1:acme-ledger:${TAG}`);

    expect(lines.map((l) => l.message)).toEqual(["FETCHSOURCE", "BUILD", "DONE"]);
    expect(calls.at(-1)?.url).toContain("log-b-1.txt");
  });

  // Someone opening the page mid-build should see progress, not an error.
  it("is empty rather than broken when the log is not written yet", async () => {
    serve([
      [/cloudbuild/, () => building],
      [/storage\.googleapis/, () => new Response("", { status: 404 })],
    ]);

    expect(await provider().getLogs(`b-1:acme-ledger:${TAG}`)).toEqual([]);
  });
});

describe("remove", () => {
  it("deletes the service", async () => {
    serve([[/run\.googleapis/, () => ({ name: "operations/1" })]]);

    await provider().remove(`b-1:acme-ledger:${TAG}`);

    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toContain("/services/acme-ledger");
  });

  it("treats already gone as done", async () => {
    serve([[/run\.googleapis/, () => new Response("", { status: 404 })]]);
    await expect(provider().remove(`b-1:acme-ledger:${TAG}`)).resolves.toBeUndefined();
  });
});

describe("invocationToken", () => {
  it("is addressed to the app's own origin and nothing more", async () => {
    serve([]);
    const token = await provider().invocationToken(
      "https://acme-ledger-abc-uc.a.run.app/reports/run?x=1",
    );
    expect(token).toBe("id-for-https://acme-ledger-abc-uc.a.run.app");
  });
});
