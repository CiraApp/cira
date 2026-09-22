import { describe, expect, it } from "vitest";
import { NeonDatabases, NeonError, neonConfigFromEnv } from "./databases.js";

const config = { apiKey: "napi_test", orgId: "org-test", region: "aws-us-east-1" };
const HOST = "ep-cool-bird-123.us-east-1.aws.neon.tech";

function fake(
  answer: (
    method: string,
    url: string,
    body: unknown,
  ) => { status: number; body?: unknown },
) {
  const calls: Array<{
    method: string;
    url: string;
    body: unknown;
    auth: string | null;
  }> = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({
      method,
      url,
      body,
      auth: new Headers(init?.headers).get("authorization"),
    });
    const reply = answer(method, url, body);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

const made = {
  project: { id: "shy-star-1" },
  connection_uris: [
    {
      connection_uri: `postgresql://neondb_owner:pw@${HOST}/neondb?sslmode=require`,
      connection_parameters: {
        database: "neondb",
        role: "neondb_owner",
        host: HOST,
        pooler_host: "ep-cool-bird-123-pooler.us-east-1.aws.neon.tech",
      },
    },
  ],
};

describe("NeonDatabases", () => {
  it("makes a project in the organisation and region, and gives both addresses", async () => {
    const { impl, calls } = fake(() => ({ status: 201, body: made }));
    const db = await new NeonDatabases(config, impl).create("acme-orders");

    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://console.neon.tech/api/v2/projects",
      body: {
        project: { name: "acme-orders", region_id: "aws-us-east-1", org_id: "org-test" },
      },
      auth: "Bearer napi_test",
    });
    expect(db).toEqual({
      projectId: "shy-star-1",
      databaseName: "neondb",
      roleName: "neondb_owner",
      urls: {
        direct: `postgresql://neondb_owner:pw@${HOST}/neondb?sslmode=require`,
        pooled:
          "postgresql://neondb_owner:pw@ep-cool-bird-123-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
      },
    });
  });

  it("works out the pooler when Neon does not name it", async () => {
    const first = made.connection_uris[0]!;
    const { impl } = fake(() => ({
      status: 201,
      body: {
        ...made,
        connection_uris: [
          {
            ...first,
            connection_parameters: {
              ...first.connection_parameters,
              pooler_host: undefined,
            },
          },
        ],
      },
    }));
    const db = await new NeonDatabases(config, impl).create("x");
    expect(db.urls.pooled).toContain("@ep-cool-bird-123-pooler.us-east-1.aws.neon.tech/");
  });

  it("deletes a project made with nothing to connect to, rather than keep it", async () => {
    const { impl, calls } = fake((method) =>
      method === "POST"
        ? { status: 201, body: { project: { id: "shy-star-2" }, connection_uris: [] } }
        : { status: 200, body: {} },
    );
    await expect(new NeonDatabases(config, impl).create("x")).rejects.toBeInstanceOf(
      NeonError,
    );
    expect(calls.map((c) => `${c.method} ${c.url}`)).toContain(
      "DELETE https://console.neon.tech/api/v2/projects/shy-star-2",
    );
  });

  it("says what Neon said when it refuses", async () => {
    const { impl } = fake(() => ({
      status: 422,
      body: { message: "projects limit exceeded" },
    }));
    await expect(new NeonDatabases(config, impl).create("x")).rejects.toMatchObject({
      message: "projects limit exceeded",
      status: 422,
    });
  });

  it("counts a project already gone as removed", async () => {
    const { impl } = fake(() => ({ status: 404, body: { message: "not found" } }));
    await expect(new NeonDatabases(config, impl).remove("gone")).resolves.toBeUndefined();
  });

  it("asks Neon for the addresses again rather than keeping them", async () => {
    const { impl, calls } = fake((_m, url) => ({
      status: 200,
      body: {
        uri: url.includes("pooled=true") ? "postgres://pooled" : "postgres://direct",
      },
    }));
    const urls = await new NeonDatabases(config, impl).urls({
      projectId: "shy-star-1",
      databaseName: "neondb",
      roleName: "neondb_owner",
    });
    expect(urls).toEqual({ pooled: "postgres://pooled", direct: "postgres://direct" });
    expect(calls[0]?.url).toContain(
      "/projects/shy-star-1/connection_uri?database_name=neondb",
    );
  });
});

describe("neonConfigFromEnv", () => {
  it("is null until both the key and the organisation are set", () => {
    expect(neonConfigFromEnv({ NEON_API_KEY: "k" })).toBeNull();
    expect(neonConfigFromEnv({ NEON_API_KEY: "k", NEON_ORG_ID: "o" })).toEqual({
      apiKey: "k",
      orgId: "o",
      region: "aws-us-east-1",
    });
  });
});
