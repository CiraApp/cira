import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { newId } from "@cira/core";
import type * as CiraDb from "@cira/db";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";
import { hashToken } from "./token-hash";

/**
 * What a bearer token opens. A terminal's token deploys; an assistant's only
 * reaches MCP; neither opens anything after ninety days unused.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

const userId = newId("user");
const tokens = {
  terminal: "cira_terminal_token",
  assistant: "cira_assistant_token",
  lapsed: "cira_lapsed_token",
};

const asking = (token: string) =>
  new Request("https://cira.dev/api/cli/me", {
    headers: { authorization: `Bearer ${token}` },
  });

describe.skipIf(!hasDatabase)("userFromRequest", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_tokens");
    const { cliTokens, users } = await import("@cira/db");
    await database
      .insert(users)
      .values({ id: userId, externalId: "t1", name: "Tess", email: "tess@acme.test" });
    const soon = new Date(Date.now() + 86_400_000);
    await database.insert(cliTokens).values([
      {
        id: newId("cliToken"),
        userId,
        tokenHash: hashToken(tokens.terminal),
        label: "laptop CLI",
        scope: "cli",
        expiresAt: soon,
      },
      {
        id: newId("cliToken"),
        userId,
        tokenHash: hashToken(tokens.assistant),
        label: "Claude Desktop",
        scope: "assistant",
        expiresAt: soon,
      },
      {
        id: newId("cliToken"),
        userId,
        tokenHash: hashToken(tokens.lapsed),
        label: "old laptop",
        scope: "cli",
        expiresAt: new Date(Date.now() - 1000),
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    await database?.end();
  });

  it("lets a terminal's token do what the CLI does", async () => {
    const { userFromRequest } = await import("./cli-session");
    expect((await userFromRequest(asking(tokens.terminal)))?.id).toBe(userId);
    expect((await userFromRequest(asking(tokens.terminal), "assistant"))?.id).toBe(
      userId,
    );
  });

  it("keeps an assistant's token to MCP", async () => {
    const { userFromRequest } = await import("./cli-session");
    // Nobody, as far as deploying and removing are concerned.
    expect(await userFromRequest(asking(tokens.assistant))).toBeNull();
    expect((await userFromRequest(asking(tokens.assistant), "assistant"))?.id).toBe(
      userId,
    );
  });

  it("opens nothing once a token has gone ninety days unused", async () => {
    const { userFromRequest } = await import("./cli-session");
    expect(await userFromRequest(asking(tokens.lapsed))).toBeNull();
    expect(await userFromRequest(asking(tokens.lapsed), "assistant")).toBeNull();
  });

  it("moves a token's expiry on each time it is used", async () => {
    const { userFromRequest, TOKEN_IDLE_DAYS } = await import("./cli-session");
    const { cliTokens } = await import("@cira/db");
    const { eq } = await import("drizzle-orm");
    await userFromRequest(asking(tokens.terminal));
    // The touch is best-effort and not awaited by the request.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const [row] = await database
      .select({ expiresAt: cliTokens.expiresAt })
      .from(cliTokens)
      .where(eq(cliTokens.tokenHash, hashToken(tokens.terminal)));
    const days = ((row?.expiresAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(TOKEN_IDLE_DAYS - 1);
  });
});
