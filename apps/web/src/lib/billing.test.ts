import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { newId } from "@cira/core";
import type * as CiraDb from "@cira/db";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * What Stripe says, arriving at a space: which plan it lands on, what it may
 * do afterwards, and the one case that matters most - a payment that failed
 * must not take a company's software away.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

const spaceId = newId("space");
const strangerId = newId("space");

describe.skipIf(!hasDatabase)("applySubscription", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_billing");
    const { spaces } = await import("@cira/db");
    await database.insert(spaces).values([
      {
        id: spaceId,
        name: "Acme",
        slug: "acme",
        domain: "acme.test",
        stripeCustomerId: "cus_acme",
      },
      { id: strangerId, name: "Other", slug: "other", domain: "other.test" },
    ]);
  }, 60_000);

  afterAll(async () => {
    await database?.end();
  });

  const spaceRow = async (id = spaceId) => {
    const { spaces } = await import("@cira/db");
    const [row] = await database.select().from(spaces).where(eq(spaces.id, id));
    return row;
  };

  beforeEach(async () => {
    const { spaces } = await import("@cira/db");
    await database
      .update(spaces)
      .set({ plan: "trial", subscriptionStatus: null, stripeSubscriptionId: null })
      .where(eq(spaces.id, spaceId));
  });

  it("puts a space on its plan when a subscription starts", async () => {
    const { applySubscription } = await import("./billing");
    await applySubscription({
      id: "sub_1",
      status: "active",
      current_period_end: 1_790_000_000,
      metadata: { spaceId },
    });
    expect(await spaceRow()).toMatchObject({
      plan: "team",
      subscriptionStatus: "active",
      stripeSubscriptionId: "sub_1",
      paidUntil: new Date(1_790_000_000 * 1000),
    });
  });

  it("leaves a company on its plan when a payment fails, and takes nothing away", async () => {
    const { applySubscription } = await import("./billing");
    await applySubscription({ id: "sub_1", status: "past_due", metadata: { spaceId } });
    const row = await spaceRow();
    expect(row).toMatchObject({ plan: "team", subscriptionStatus: "past_due" });
  });

  it("falls back to a trial's allowance once a subscription is cancelled", async () => {
    const { applySubscription } = await import("./billing");
    await applySubscription({ id: "sub_1", status: "canceled", metadata: { spaceId } });
    expect(await spaceRow()).toMatchObject({
      plan: "trial",
      subscriptionStatus: "canceled",
    });
  });

  it("finds the space by its customer when the subscription names none", async () => {
    const { applySubscription } = await import("./billing");
    await applySubscription({ id: "sub_2", status: "active", customer: "cus_acme" });
    expect(await spaceRow()).toMatchObject({
      plan: "team",
      stripeSubscriptionId: "sub_2",
    });
  });

  it("changes nothing for a subscription about a space Cira does not have", async () => {
    const { applySubscription } = await import("./billing");
    await applySubscription({
      id: "sub_x",
      status: "active",
      metadata: { spaceId: newId("space") },
    });
    expect(await spaceRow()).toMatchObject({ plan: "trial" });
    expect(await spaceRow(strangerId)).toMatchObject({ plan: "trial" });
  });
});
