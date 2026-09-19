import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeLogsError, type AppDeploymentInput } from "@cira/core";
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
const SERVICE = "acme-ledger-0000app1";
const IMAGE = `us-central1-docker.pkg.dev/proj/cira-apps/${SERVICE}:${TAG}`;

/** The ordinary app: one thing, built from the root, taking the port. */
const oneService = {
  slug: "app",
  sourcePath: "",
  dockerfile: null,
  port: null,
  ingress: true,
} as const;

const input: AppDeploymentInput = {
  services: [oneService],
  appId: "app_00000000000000000000000000000app1",
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
    terminalCondition: { type: "Ready", state: "CONDITION_SUCCEEDED" },
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
    expect(result.providerDeploymentId).toBe(`b-1:${SERVICE}:${TAG}`);
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
  const handle = `b-1:${SERVICE}:${TAG}`;

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
              state: "CONDITION_FAILED",
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

    const lines = await provider().getLogs(`b-1:${SERVICE}:${TAG}`);

    expect(lines.map((l) => l.message)).toEqual(["FETCHSOURCE", "BUILD", "DONE"]);
    expect(calls.at(-1)?.url).toContain("log-b-1.txt");
  });

  // Someone opening the page mid-build should see progress, not an error.
  it("is empty rather than broken when the log is not written yet", async () => {
    serve([
      [/cloudbuild/, () => building],
      [/storage\.googleapis/, () => new Response("", { status: 404 })],
    ]);

    expect(await provider().getLogs(`b-1:${SERVICE}:${TAG}`)).toEqual([]);
  });
});

describe("getRuntimeLogs", () => {
  const query = {
    since: new Date("2026-09-19T13:00:00.000Z"),
    until: new Date("2026-09-19T14:00:00.000Z"),
    minimum: "all" as const,
    search: null,
    order: "newest" as const,
    pageToken: null,
    limit: 200,
  };

  it("asks Cloud Logging for this app's service and nothing else", async () => {
    serve([
      [
        /logging\.googleapis/,
        () => ({
          entries: [
            {
              insertId: "1",
              timestamp: "2026-09-19T13:59:00Z",
              severity: "INFO",
              textPayload: "orders service on :8080",
            },
          ],
          nextPageToken: "older",
        }),
      ],
    ]);

    const page = await provider().getRuntimeLogs(`b-1:${SERVICE}:${TAG}`, query);

    expect(page.nextPageToken).toBe("older");
    expect(page.entries.map((e) => e.message)).toEqual(["orders service on :8080"]);

    const call = calls.at(-1);
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe("https://logging.googleapis.com/v2/entries:list");
    const body = call?.body as Record<string, unknown>;
    expect(body["resourceNames"]).toEqual(["projects/proj"]);
    expect(body["orderBy"]).toBe("timestamp desc");
    expect(body["pageSize"]).toBe(200);
    expect(body["pageToken"]).toBeUndefined();
    // The service is the one the deployment names, in the app's own region.
    expect(body["filter"]).toContain(`resource.labels.service_name = "${SERVICE}"`);
    expect(body["filter"]).toContain('resource.labels.location = "us-central1"');
  });

  it("reads forwards for Live, and continues from a page token", async () => {
    serve([[/logging\.googleapis/, () => ({})]]);

    const page = await provider().getRuntimeLogs(`b-1:${SERVICE}:${TAG}`, {
      ...query,
      order: "oldest",
      pageToken: "t-2",
      limit: 10_000,
    });

    expect(page).toEqual({ entries: [], nextPageToken: null });
    const body = calls.at(-1)?.body as Record<string, unknown>;
    expect(body["orderBy"]).toBe("timestamp asc");
    expect(body["pageToken"]).toBe("t-2");
    // Google caps a page; asking for more than it allows is clamped here.
    expect(body["pageSize"]).toBe(500);
  });

  /**
   * Google's refusals, as reasons a page can act on. The text Google sends
   * names the project and the service account, so none of it is passed on.
   */
  it("turns Google's refusals into reasons, and repeats none of Google's words", async () => {
    const reasons: Array<[number, string]> = [
      [403, "not-allowed"],
      [429, "busy"],
      [500, "unavailable"],
    ];
    for (const [status, reason] of reasons) {
      serve([
        [
          /logging\.googleapis/,
          () =>
            new Response(
              JSON.stringify({
                error: {
                  message:
                    "deployer@proj.iam.gserviceaccount.com lacks logging.logEntries.list",
                },
              }),
              { status },
            ),
        ],
      ]);

      const failure = await provider()
        .getRuntimeLogs(`b-1:${SERVICE}:${TAG}`, query)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(RuntimeLogsError);
      expect((failure as RuntimeLogsError).reason).toBe(reason);
      expect((failure as Error).message).not.toContain("deployer@");
    }
  });

  it("refuses a deployment Cloud Run did not make", async () => {
    await expect(provider().getRuntimeLogs("dpl_vercel123", query)).rejects.toThrow(
      "not made by Cloud Run",
    );
  });
});

describe("remove", () => {
  it("deletes the service", async () => {
    serve([[/run\.googleapis/, () => ({ name: "operations/1" })]]);

    await provider().remove(`b-1:${SERVICE}:${TAG}`);

    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toContain(`/services/${SERVICE}`);
  });

  it("treats already gone as done", async () => {
    serve([[/run\.googleapis/, () => new Response("", { status: 404 })]]);
    await expect(provider().remove(`b-1:${SERVICE}:${TAG}`)).resolves.toBeUndefined();
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

describe("teardown", () => {
  const SERVICE = "acme-ledger-0000app1";

  /**
   * The service is what stops it serving; the images are what stop it costing.
   * Every deploy pushed one and nothing else ever removes them, so an app
   * deleted a year ago would still be paying for every version it ever had.
   */
  it("removes the service and every image it was built into", async () => {
    serve([[/./, () => ({})]]);

    const result = await provider().teardown(SERVICE);

    const deletes = calls.filter((c) => c.method === "DELETE");
    expect(deletes.some((c) => c.url.includes(`/services/${SERVICE}`))).toBe(true);
    expect(
      deletes.some(
        (c) =>
          c.url.includes("artifactregistry") && c.url.endsWith(`/packages/${SERVICE}`),
      ),
    ).toBe(true);
    expect(result.images).toBe(true);
  });

  it("takes the service down before touching the images", async () => {
    serve([[/./, () => ({})]]);

    await provider().teardown(SERVICE);

    const order = calls.filter((c) => c.method === "DELETE").map((c) => c.url);
    const service = order.findIndex((u) => u.includes("/services/"));
    const images = order.findIndex((u) => u.includes("artifactregistry"));
    expect(service).toBeLessThan(images);
  });

  // Storage left behind is a bill, not a hazard. The app is already down.
  it("still counts as done when the images will not delete", async () => {
    serve([
      [/artifactregistry/, () => new Response(null, { status: 403 })],
      [/run\.googleapis/, () => ({})],
    ]);

    const result = await provider().teardown(SERVICE);
    expect(result.images).toBe(false);
  });

  it("treats images that are already gone as deleted", async () => {
    serve([
      [/artifactregistry/, () => new Response(null, { status: 404 })],
      [/run\.googleapis/, () => ({})],
    ]);

    expect((await provider().teardown(SERVICE)).images).toBe(true);
  });

  it("does not delete anything when the service will not go", async () => {
    serve([[/./, () => new Response(null, { status: 500 })]]);

    await expect(provider().teardown(SERVICE)).rejects.toThrow();
    expect(calls.some((c) => c.url.includes("artifactregistry"))).toBe(false);
  });
});

/**
 * Buildpacks work the language out, which is why Cira deploys more than
 * Next.js - but they cannot work out how to start something they do not
 * recognise. A project that already says so in a Dockerfile has answered the
 * question, and Wave's build failed for want of an answer it had written down.
 */
describe("a Dockerfile wins when there is one", () => {
  const dockerised: AppDeploymentInput = {
    ...input,
    services: [{ ...oneService, dockerfile: "Dockerfile", port: 8000 }],
  };

  it("builds the image the project describes", async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);

    await provider().deploy(dockerised);

    const build = calls.find((c) => c.url.includes("cloudbuild"))?.body as {
      steps: Array<{ name: string; args: string[]; env?: string[] }>;
    };
    expect(build.steps.map((s) => s.name)).toEqual([
      "gcr.io/cloud-builders/docker",
      "gcr.io/cloud-builders/docker",
    ]);
    expect(build.steps[0]?.args).toContain("build");
    expect(build.steps[1]?.args).toContain("push");
    expect(JSON.stringify(build)).not.toContain("pack");

    // A Dockerfile written any time recently assumes BuildKit.
    // `RUN --mount=type=cache` fails without it, on a line its author never
    // thought twice about.
    expect(build.steps[0]?.env).toContain("DOCKER_BUILDKIT=1");
  });

  /**
   * The half that makes the other half work. Cloud Run routes to the port the
   * service names and sets `PORT` to match, so an image hardcoding 8000 is
   * correct only if Cira says 8000. Assuming a default leaves a container that
   * built, started, and never receives a request.
   */
  it("routes to the port the image declares", async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);

    await provider().deploy(dockerised);

    const body = calls.find((c) => c.method === "PATCH")?.body as {
      template: { containers: Array<{ ports: Array<{ containerPort: number }> }> };
    };
    expect(body.template.containers[0]?.ports[0]?.containerPort).toBe(8000);
  });

  it("falls back to buildpacks when the project says nothing", async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);

    await provider().deploy(input);

    const build = calls.find((c) => c.url.includes("cloudbuild"))?.body as {
      steps: Array<{ name: string }>;
    };
    expect(build.steps[0]?.name).toBe("gcr.io/k8s-skaffold/pack");

    const body = calls.find((c) => c.method === "PATCH")?.body as {
      template: { containers: Array<{ ports: Array<{ containerPort: number }> }> };
    };
    expect(body.template.containers[0]?.ports[0]?.containerPort).toBe(8080);
  });

  // The deploy that knew which port the image wanted is long over by the time
  // the built image is rolled out, so the service is asked rather than assumed.
  it("keeps the port when the image is swapped in later", async () => {
    serve([
      [/cloudbuild/, () => built],
      [
        /run\.googleapis/,
        (m) =>
          m === "GET"
            ? serviceAt("older-image", {
                template: {
                  labels: {},
                  containers: [
                    { image: "older-image", env: [], ports: [{ containerPort: 8000 }] },
                  ],
                },
              })
            : {},
      ],
    ]);

    await provider().getStatus(`b-1:${SERVICE}:${TAG}`);

    const body = calls.find((c) => c.method === "PATCH")?.body as {
      template: { containers: Array<{ ports: Array<{ containerPort: number }> }> };
    };
    expect(body.template.containers[0]?.ports[0]?.containerPort).toBe(8000);
  });
});

/**
 * A monorepo keeps the Dockerfile with the service and builds from the
 * workspace. Wave's own deploy notes say so outright, and it is why the
 * context and the file cannot be assumed to be the same folder.
 */
describe("a Dockerfile that is not at the root", () => {
  it("names the file and still builds from the whole upload", async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);

    await provider().deploy({
      ...input,
      services: [{ ...oneService, dockerfile: "apps/api/Dockerfile", port: 8000 }],
    });

    const build = calls.find((c) => c.url.includes("cloudbuild"))?.body as {
      steps: Array<{ args: string[] }>;
    };
    expect(build.steps[0]?.args).toEqual([
      "build",
      "-f",
      "apps/api/Dockerfile",
      "-t",
      IMAGE,
      ".",
    ]);
  });
});

/**
 * A frontend and the API behind it, in one instance, sharing localhost.
 *
 * The point of doing it this way rather than deploying two services and
 * routing between them: an app already written to proxy to its backend in
 * development finds it at the same address in production, because in
 * development it was already talking to localhost. Wave needs no change at all.
 */
describe("an app that is two halves", () => {
  const web = {
    slug: "web",
    sourcePath: "apps/web",
    dockerfile: null,
    port: null,
    ingress: true,
  } as const;

  const api = {
    slug: "api",
    sourcePath: "apps/api",
    dockerfile: "apps/api/Dockerfile",
    port: 8000,
    ingress: false,
  } as const;

  const both: AppDeploymentInput = { ...input, services: [web, api] };

  const deployBoth = async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);
    await provider().deploy(both);

    return {
      build: calls.find((c) => c.url.includes("cloudbuild"))?.body as {
        steps: Array<{ name: string; args: string[] }>;
      },
      service: (
        calls.find((c) => c.method === "PATCH")?.body as {
          template: {
            containers: Array<{
              name?: string;
              image: string;
              ports?: Array<{ containerPort: number }>;
              dependsOn?: string[];
              resources: { limits: { memory: string }; cpuIdle: boolean };
            }>;
          };
        }
      ).template.containers,
    };
  };

  it("builds each half the way that half asks to be built", async () => {
    const { build } = await deployBoth();

    // Buildpacks for the frontend, pointed at its own directory; the API's own
    // Dockerfile for the API, with the whole upload still as the context.
    expect(build.steps.map((s) => s.name)).toEqual([
      "gcr.io/k8s-skaffold/pack",
      "gcr.io/cloud-builders/docker",
      "gcr.io/cloud-builders/docker",
    ]);
    expect(build.steps[0]?.args).toContain("--path");
    expect(build.steps[0]?.args).toContain("apps/web");
    expect(build.steps[1]?.args).toContain("apps/api/Dockerfile");
  });

  it("builds them in one build, so they succeed or fail together", async () => {
    await deployBoth();
    expect(calls.filter((c) => c.url.includes("/builds"))).toHaveLength(1);
  });

  it("gives each half an image of its own", async () => {
    const { service } = await deployBoth();
    const images = service.map((c) => c.image);
    expect(new Set(images).size).toBe(2);
    expect(images.every((i) => i.includes("acme-ledger"))).toBe(true);
  });

  it("gives the port to the front door and to nothing else", async () => {
    const { service } = await deployBoth();

    const ingress = service.find((c) => c.name === "web");
    const sidecar = service.find((c) => c.name === "api");

    expect(ingress?.ports?.[0]?.containerPort).toBe(8080);
    // Cloud Run permits exactly one container to expose a port, and the API is
    // reached at localhost by the half in front of it.
    expect(sidecar?.ports).toBeUndefined();
  });

  it("starts the backend before the half that calls it", async () => {
    const { service } = await deployBoth();
    expect(service.find((c) => c.name === "web")?.dependsOn).toEqual(["api"]);
  });

  /**
   * Cloud Run refuses the dependency above without one - it has no other way
   * to tell that a sidecar is up. A socket that accepts a connection is the
   * most a platform can know about an arbitrary backend.
   */
  it("gives the backend a way to say it is listening", async () => {
    const { service } = await deployBoth();
    const probe = service.find((c) => c.name === "api")?.startupProbe;

    expect(probe?.tcpSocket?.port).toBe(8000);
    expect(service.find((c) => c.name === "web")?.startupProbe).toBeUndefined();
  });

  /**
   * The front door will not take traffic until this passes, so the gap between
   * the backend listening and Cloud Run noticing is time every single cold
   * start pays for. Asking every five seconds meant a backend up in one waited
   * four more for no reason.
   */
  it("notices the backend is up promptly, not eventually", async () => {
    const { service } = await deployBoth();
    const probe = service.find((c) => c.name === "api")?.startupProbe;

    expect(probe?.periodSeconds).toBe(1);
    // Cloud Run refuses a timeout longer than the period it is asked on.
    expect(probe?.timeoutSeconds).toBeLessThanOrEqual(probe?.periodSeconds ?? 0);
    // And the patience is unchanged: the same budget, in smaller steps.
    expect((probe?.failureThreshold ?? 0) * (probe?.periodSeconds ?? 0)).toBe(100);
  });

  it("does not depend on a sidecar that never said where it listens", async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);
    await provider().deploy({ ...input, services: [web, { ...api, port: null }] });

    const containers = (
      calls.find((c) => c.method === "PATCH")?.body as {
        template: { containers: Array<{ name?: string; dependsOn?: string[] }> };
      }
    ).template.containers;

    // Depending on it would be refused outright, and starting alongside is
    // what happened before any of this existed.
    expect(containers.find((c) => c.name === "web")?.dependsOn).toBeUndefined();
  });

  /**
   * The setting that would really have bitten. `cpuIdle` throttles CPU outside
   * request handling, which is right for a lone web server and wrong the moment
   * anything runs beside it: a backend with a subscriber loop or a queue thread
   * simply stops being scheduled, and returns looking like flakiness.
   */
  it("keeps the CPU on, and makes room for two runtimes", async () => {
    const { service } = await deployBoth();

    for (const container of service) {
      expect(container.resources.cpuIdle).toBe(false);
      expect(container.resources.limits.memory).toBe("1Gi");
    }
  });

  it("leaves an ordinary single app exactly as it was", async () => {
    serve([
      [/cloudbuild.*\/builds$/, () => ({ metadata: { build: building } })],
      [/run\.googleapis/, (m) => (m === "GET" ? new Response("", { status: 404 }) : {})],
    ]);
    await provider().deploy(input);

    const containers = (
      calls.find((c) => c.method === "PATCH")?.body as {
        template: {
          containers: Array<{
            name?: string;
            resources: { limits: { memory: string }; cpuIdle: boolean };
          }>;
        };
      }
    ).template.containers;

    expect(containers).toHaveLength(1);
    // Unnamed, because naming the sole container of a service that already
    // exists replaces it rather than updating it.
    expect(containers[0]?.name).toBeUndefined();
    expect(containers[0]?.resources).toEqual({
      limits: { cpu: "1", memory: "512Mi" },
      cpuIdle: true,
    });
  });
});

/**
 * The swap that happens once the build finishes, for an app of two halves.
 *
 * Everything the deploy wrote has to survive it. The sidecar's port is the
 * awkward one: a sidecar has no `ports`, so the only record of where it listens
 * is the probe written to watch it, and losing that would drop the startup
 * ordering at the moment nobody is looking.
 */
describe("rolling out both halves", () => {
  const twoContainers = {
    uri: "https://acme-ledger-abc-uc.a.run.app",
    latestReadyRevision: "r1",
    latestCreatedRevision: "r1",
    terminalCondition: { type: "Ready", state: "CONDITION_SUCCEEDED" },
    template: {
      labels: {},
      containers: [
        {
          name: "web",
          image: "old-web",
          ports: [{ name: "http1", containerPort: 8080 }],
          dependsOn: ["api"],
        },
        {
          name: "api",
          image: "old-api",
          startupProbe: { tcpSocket: { port: 8000 } },
        },
      ],
    },
  };

  it("keeps the ordering and the probe when the built images go in", async () => {
    serve([
      [/cloudbuild/, () => ({ id: "b-1", status: "SUCCESS" })],
      [/run\.googleapis/, (m) => (m === "GET" ? twoContainers : {})],
    ]);

    await provider().getStatus(`b-1:${SERVICE}:${TAG}`);

    const containers = (
      calls.find((c) => c.method === "PATCH")?.body as {
        template: {
          containers: Array<{
            name?: string;
            image: string;
            dependsOn?: string[];
            startupProbe?: {
              tcpSocket?: { port: number };
              periodSeconds?: number;
              timeoutSeconds?: number;
              failureThreshold?: number;
            };
          }>;
        };
      }
    ).template.containers;

    expect(containers.find((c) => c.name === "web")?.dependsOn).toEqual(["api"]);
    expect(containers.find((c) => c.name === "api")?.startupProbe?.tcpSocket?.port).toBe(
      8000,
    );

    // And both halves move to the images this build produced.
    expect(containers.every((c) => c.image.includes(TAG))).toBe(true);
    expect(new Set(containers.map((c) => c.image)).size).toBe(2);
  });
});
