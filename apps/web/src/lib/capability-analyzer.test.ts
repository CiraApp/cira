import { describe, expect, it } from "vitest";
import type { RepoSummary } from "@cira/extract";
import { analyzeCapabilities } from "./capability-analyzer";

/**
 * The one link in the engine that cannot be tested without calling the model.
 *
 * Everything either side of it is covered deterministically - the extractor
 * that produces this input, and the grounding that refuses anything the model
 * cannot back up. What is left, and what this asserts, is judgement: that a
 * real repository produces the operations an employee would recognise, and
 * that the obvious wrong answers are not among them.
 *
 * Skipped without a key, the way the database suites skip without a database,
 * so CI stays secret-free and `pnpm test` still works on a laptop.
 */
const hasKey =
  process.env["ANTHROPIC_API_KEY"] !== undefined &&
  process.env["ANTHROPIC_API_KEY"] !== "";

/**
 * A plausible internal revenue app. Three routes worth exposing, and three
 * that are not: a health check, an internal cache reset, and the auth
 * callback. Getting the second set wrong is what the analyzer's instructions
 * exist to prevent.
 */
const revenueApp: RepoSummary = {
  framework: "nextjs",
  packageName: "finance-dashboard",
  dependencies: ["next", "react", "zod", "drizzle-orm", "@neondatabase/serverless"],
  routes: [
    {
      path: "/api/revenue",
      methods: ["GET"],
      file: "app/api/revenue/route.ts",
      dynamic: false,
      doc: "Total revenue between two dates.",
      excerpt: `const query = z.object({ startDate: z.string(), endDate: z.string() });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const { startDate, endDate } = query.parse({
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
  });
  const rows = await db.select().from(invoices)
    .where(and(gte(invoices.paidAt, startDate), lte(invoices.paidAt, endDate)));
  const total = rows.reduce((sum, row) => sum + row.amountCents, 0) / 100;
  return NextResponse.json({ total, currency: "USD", invoiceCount: rows.length });
}`,
    },
    {
      path: "/api/revenue/by-customer",
      methods: ["GET"],
      file: "app/api/revenue/by-customer/route.ts",
      dynamic: false,
      doc: "Revenue grouped by customer for a month.",
      excerpt: `export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month");
  const rows = await db.select({ customer: invoices.customerName, total: sum(invoices.amountCents) })
    .from(invoices).where(eq(invoices.month, month)).groupBy(invoices.customerName);
  return NextResponse.json({ month, customers: rows });
}`,
    },
    {
      path: "/api/refunds",
      methods: ["POST"],
      file: "app/api/refunds/route.ts",
      dynamic: false,
      doc: "Issue a refund against an invoice.",
      excerpt: `const body = z.object({ invoiceId: z.string(), amountCents: z.number().int() });

export async function POST(request: Request) {
  const { invoiceId, amountCents } = body.parse(await request.json());
  const refund = await stripe.refunds.create({ payment_intent: invoiceId, amount: amountCents });
  await db.insert(refunds).values({ invoiceId, amountCents, providerId: refund.id });
  return NextResponse.json({ refundId: refund.id, status: refund.status });
}`,
    },
    {
      path: "/api/health",
      methods: ["GET"],
      file: "app/api/health/route.ts",
      dynamic: false,
      doc: null,
      excerpt: `export async function GET() { return NextResponse.json({ ok: true }); }`,
    },
    {
      path: "/api/internal/reset-cache",
      methods: ["POST"],
      file: "app/api/internal/reset-cache/route.ts",
      dynamic: false,
      doc: "Clears the memo cache. Internal only.",
      excerpt: `export async function POST() { memoCache.clear(); return NextResponse.json({ cleared: true }); }`,
    },
    {
      path: "/api/auth/callback",
      methods: ["GET"],
      file: "app/api/auth/callback/route.ts",
      dynamic: false,
      doc: null,
      excerpt: `export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  const session = await exchangeCodeForSession(code);
  return NextResponse.redirect("/", { headers: { "set-cookie": session.cookie } });
}`,
    },
  ],
  functions: [
    {
      name: "formatCurrency",
      file: "lib/format.ts",
      signature: "formatCurrency(cents: number): string",
      doc: null,
      serverAction: false,
    },
    {
      name: "monthlyGrowth",
      file: "lib/revenue.ts",
      signature: "monthlyGrowth(month: string): Promise<number>",
      doc: "Month over month growth, as a fraction.",
      serverAction: false,
    },
  ],
  shapes: [
    {
      name: "Invoice",
      file: "lib/types.ts",
      kind: "interface",
      text: "export interface Invoice { id: string; customerName: string; amountCents: number; paidAt: string }",
    },
  ],
  notes: [],
};

describe.skipIf(!hasKey)("analyzeCapabilities", () => {
  it("finds the business operations and leaves the plumbing alone", async () => {
    const result = await analyzeCapabilities(revenueApp, {
      appName: "Finance Dashboard",
    });

    if (!result.ok) throw new Error(`analysis failed: ${result.error}`);
    const found = result.capabilities;

    // Something is found at all: the call shape works end to end.
    expect(found.length).toBeGreaterThan(0);

    const paths = found.map((c) => c.path);
    // eslint-disable-next-line no-console
    console.log(
      "detected:",
      found.map((c) => `${c.name} [${c.risk} ${c.confidence}] ${c.method} ${c.path}`),
    );

    // The revenue query is the operation this app exists for.
    const revenue = found.find((c) => c.path === "/api/revenue");
    expect(revenue, "expected a capability for /api/revenue").toBeDefined();
    expect(revenue?.method).toBe("GET");
    expect(revenue?.risk).toBe("read");
    expect(revenue?.name.toLowerCase()).toContain("revenue");
    expect(Object.keys(revenue?.inputSchema["properties"] ?? {})).toEqual(
      expect.arrayContaining(["startDate", "endDate"]),
    );

    // Plumbing is not a capability.
    expect(paths).not.toContain("/api/health");
    expect(paths).not.toContain("/api/internal/reset-cache");
    expect(paths).not.toContain("/api/auth/callback");

    // Refunding money is never a read, and never auto-enabled.
    const refund = found.find((c) => c.path === "/api/refunds");
    if (refund !== undefined) {
      expect(["write", "destructive"]).toContain(refund.risk);
    }

    // Grounding holds: nothing points anywhere the app does not serve.
    const real = new Set(revenueApp.routes.map((r) => r.path));
    for (const capability of found) {
      expect(real.has(capability.path), capability.path).toBe(true);
    }
  }, 240_000);

  it("returns nothing for an app that serves no routes, without calling the model", async () => {
    const result = await analyzeCapabilities(
      { ...revenueApp, routes: [] },
      { appName: "Empty" },
    );
    expect(result).toEqual({ ok: true, capabilities: [] });
  }, 30_000);
});
