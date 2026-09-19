import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { User } from "@cira/core";
import type { AskEvent } from "./protocol";

/**
 * Ask Cira for real: the actual model, the actual tools, a real database.
 *
 * Everything else in this folder runs against a scripted model, which proves
 * the loop's rules but not that Haiku, given these instructions and these
 * tools, finds the right capability and answers a person in plain words. This
 * does, against the demo company, whose apps answer from a table - so nothing
 * here depends on Google or on any deployed app being up.
 *
 * It spends money and needs credentials, so it only runs when asked:
 *
 *   ASK_LIVE_DATABASE_URL=<a disposable branch, never production>
 *   ASK_LIVE_USER_ID=<someone who owns the demo space on it>
 *   ANTHROPIC_API_KEY=...
 *
 * Run it after changing the prompt, the tools or `CIRA_ASK_MODEL`.
 */

const url = process.env["ASK_LIVE_DATABASE_URL"];
const userId = process.env["ASK_LIVE_USER_ID"];
const live =
  url !== undefined &&
  userId !== undefined &&
  process.env["ANTHROPIC_API_KEY"] !== undefined;

describe.skipIf(!live)("Ask Cira, live", () => {
  let user: User;
  const previous = process.env["DATABASE_URL"];

  beforeAll(async () => {
    process.env["DATABASE_URL"] = url;

    const { db, users, apps } = await import("@cira/db");
    const { eq, like } = await import("drizzle-orm");
    const { verifyAppCapabilities } = await import("@/lib/capability-verification");

    const [row] = await db()
      .select()
      .from(users)
      .where(eq(users.id, userId as string));
    if (row === undefined)
      throw new Error("ASK_LIVE_USER_ID is not a user on that database.");
    user = { id: row.id, name: row.name, email: row.email, createdAt: row.createdAt };

    // The demo apps confirm their capabilities from a table, which is what
    // makes them callable at all.
    const demo = await db()
      .select({ id: apps.id })
      .from(apps)
      .where(like(apps.id, "%_demo_%"));
    for (const app of demo) await verifyAppCapabilities(app.id);
  }, 120_000);

  afterAll(() => {
    process.env["DATABASE_URL"] = previous;
  });

  async function askLive(question: string) {
    const { runAsk } = await import("./agent");
    const { anthropicModel, askTools } = await import("./model");
    const { askSystemPrompt } = await import("./prompt");
    const { runTool } = await import("@/lib/mcp");
    const { getCapabilityForUser } = await import("@/lib/capabilities");

    const events: AskEvent[] = [];
    const usage = await runAsk({
      model: anthropicModel(new AbortController().signal),
      host: {
        run: (name, args) =>
          runTool(user, name, args, { via: "ask", origin: "https://cira.test" }),
        capability: (id) => getCapabilityForUser(user, id),
      },
      system: askSystemPrompt(new Date()),
      tools: askTools(),
      history: [],
      input: { question },
      emit: (event) => events.push(event),
    });

    const answer = events
      .filter((e): e is Extract<AskEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.text)
      .join("");
    const steps = events.filter(
      (e): e is Extract<AskEvent, { type: "step" }> =>
        e.type === "step" && e.state !== "running",
    );
    return { events, answer, steps, usage };
  }

  it("answers a plain question from the right app, in plain words", async () => {
    const { answer, steps, usage } = await askLive(
      "How much revenue did we make last month?",
    );

    const invoked = steps.find((s) => s.data !== undefined);
    expect(invoked?.app?.name).toBe("Ledger");
    expect(invoked?.state).toBe("done");
    expect(answer).toMatch(/\$\s?[\d,]+/);
    // Written for a person: no capability ids, no code-style names.
    expect(answer).not.toMatch(/cap_|monthlyRevenue|capabilityId/);
    expect(usage.toolCalls).toBeLessThanOrEqual(5);

    process.stdout.write(
      `\n  Q: How much revenue did we make last month?\n  A: ${JSON.stringify(answer)}\n  steps: ${steps.map((s) => s.label).join(" -> ")}\n  tokens: ${usage.inputTokens} in / ${usage.outputTokens} out\n`,
    );
  }, 120_000);

  it("stops at a write and runs nothing without a person", async () => {
    const { db, capabilities } = await import("@cira/db");
    const { and, eq, like } = await import("drizzle-orm");

    // Switched on for this run only, on a disposable database: writes start
    // off, and one that is off is never held - it is refused in words.
    await db()
      .update(capabilities)
      .set({ enabled: true })
      .where(
        and(eq(capabilities.name, "issueRefund"), like(capabilities.appId, "%_demo_%")),
      );

    const { events, answer } = await askLive(
      "Refund invoice INV-2041 in full - it was $120.",
    );
    const confirm = events.find((e) => e.type === "confirm");

    expect(confirm).toMatchObject({
      type: "confirm",
      action: "Issue refund",
      app: { name: "Ledger" },
    });
    expect(
      events.some((e) => e.type === "step" && e.label.startsWith("Issue refund for")),
    ).toBe(false);

    process.stdout.write(
      `\n  Q: Refund invoice INV-2041 in full\n  held: ${JSON.stringify(confirm)}\n  A: ${answer}\n`,
    );
  }, 120_000);
});
