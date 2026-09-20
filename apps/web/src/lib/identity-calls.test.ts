import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createVerify, generateKeyPairSync, createPublicKey } from "node:crypto";
import { eq } from "drizzle-orm";
import { newId, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * What actually reaches an app when Cira calls it, now that Cira can say who
 * is asking. Two things have to be true: an app that did not ask is called
 * exactly as before, and an app that did gets something it can verify.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    deploymentProvider: () => ({
      invocationToken: () => Promise.resolve("google-id-token"),
    }),
  };
});

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

const person: User = {
  id: newId("user"),
  name: "Sam Reed",
  email: "sam@acme.test",
  createdAt: new Date(),
};
const spaceId = newId("space");
const quietId = newId("app");
const tellingId = newId("app");
const quietCapability = newId("capability");
const tellingCapability = newId("capability");

/** Every request Cira made to an app, as the app would see it. */
const sent: Array<{ url: string; headers: Record<string, string> }> = [];

describe.skipIf(!hasDatabase)("telling an app who is calling", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_identity");
    const { apps, capabilities, deployments, memberships, spaces, users } =
      await import("@cira/db");
    await database.insert(users).values({
      id: person.id,
      externalId: "i1",
      name: person.name,
      email: person.email,
    });
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "Acme", slug: "acme", domain: "acme.test" });
    await database
      .insert(memberships)
      .values({ id: newId("membership"), userId: person.id, spaceId, role: "owner" });

    for (const [id, slug, tells] of [
      [quietId, "quiet", false],
      [tellingId, "telling", true],
    ] as const) {
      await database.insert(apps).values({
        id,
        spaceId,
        name: slug,
        slug,
        status: "live",
        ownerUserId: person.id,
        tellsWhoIsCalling: tells,
      });
      await database.insert(deployments).values({
        id: newId("deployment"),
        appId: id,
        provider: "cloudrun",
        providerDeploymentId: `b1:acme-${slug}-0000app1:t1`,
        status: "live",
        url: `https://acme-${slug}.a.run.app`,
      });
    }

    await database.insert(capabilities).values([
      {
        id: quietCapability,
        spaceId,
        appId: quietId,
        name: "getRevenue",
        description: "Revenue.",
        inputSchema: { type: "object" },
        method: "GET",
        path: "/revenue",
        risk: "read",
        enabled: true,
        reach: "callable",
      },
      {
        id: tellingCapability,
        spaceId,
        appId: tellingId,
        name: "myOrders",
        description: "The caller's orders.",
        inputSchema: { type: "object" },
        method: "GET",
        path: "/orders/mine",
        risk: "read",
        enabled: true,
        reach: "callable",
      },
    ]);

    vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit) => {
      sent.push({
        url: String(url),
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubEnv("CIRA_IDENTITY_KEY", Buffer.from(pem, "utf8").toString("base64"));
    vi.stubEnv("CIRA_IDENTITY_KEY_ID", "k-test");
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await database?.end();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  const run = async (capabilityId: string) => {
    const { invokeCapability } = await import("./invoke-capability");
    return invokeCapability({ user: person, capabilityId, input: {}, via: "ask" });
  };

  it("says nothing about anyone to an app that did not ask", async () => {
    const result = await run(quietCapability);
    expect(result.ok).toBe(true);
    const headers = sent[0]?.headers ?? {};
    expect(headers).not.toHaveProperty("x-cira-identity");
    // Exactly what it always sent, and nothing about a person.
    expect(Object.keys(headers).sort()).toEqual([
      "accept",
      "content-type",
      "x-cira-capability",
      "x-serverless-authorization",
    ]);
  });

  it("sends a verifiable statement to an app that did", async () => {
    const { ISSUER } = await import("./identity-assertion");
    const result = await run(tellingCapability);
    expect(result.ok).toBe(true);

    const token = (sent[0]?.headers ?? {})["x-cira-identity"];
    expect(token).toBeDefined();

    const [head, body, signature] = (token as string).split(".");
    const verifier = createVerify("sha256");
    verifier.update(`${head}.${body}`);
    expect(
      verifier.verify(
        { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" },
        Buffer.from(signature ?? "", "base64url"),
      ),
    ).toBe(true);

    const claims = JSON.parse(Buffer.from(body ?? "", "base64url").toString()) as Record<
      string,
      unknown
    >;
    expect(claims).toMatchObject({
      iss: ISSUER,
      // The app it was sent to, so it is useless at any other.
      aud: "https://acme-telling.a.run.app",
      sub: person.id,
      email: "sam@acme.test",
      space: "acme",
      via: "ask",
    });
  });

  it("stops telling an app the moment its managers turn it off", async () => {
    const { apps } = await import("@cira/db");
    await database
      .update(apps)
      .set({ tellsWhoIsCalling: false })
      .where(eq(apps.id, tellingId));

    await run(tellingCapability);
    expect(sent[0]?.headers).not.toHaveProperty("x-cira-identity");

    await database
      .update(apps)
      .set({ tellsWhoIsCalling: true })
      .where(eq(apps.id, tellingId));
  });
});
