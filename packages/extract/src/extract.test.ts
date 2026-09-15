import { describe, expect, it } from "vitest";
import { extractRepo, routePathFor } from "./extract.js";

describe("routePathFor", () => {
  it("reads App Router routes, with or without src", () => {
    expect(routePathFor("app/api/revenue/route.ts")).toBe("/api/revenue");
    expect(routePathFor("src/app/api/revenue/route.ts")).toBe("/api/revenue");
  });

  it("drops route groups and private folders, which never reach the URL", () => {
    expect(routePathFor("app/(dashboard)/api/revenue/route.ts")).toBe("/api/revenue");
    expect(routePathFor("app/_internal/api/x/route.ts")).toBe("/api/x");
  });

  it("keeps dynamic segments as written", () => {
    expect(routePathFor("app/api/customers/[id]/route.ts")).toBe("/api/customers/[id]");
  });

  it("reads Pages Router API routes, collapsing index", () => {
    expect(routePathFor("pages/api/revenue.ts")).toBe("/api/revenue");
    expect(routePathFor("src/pages/api/revenue/index.ts")).toBe("/api/revenue");
  });

  it("is not fooled by files that merely live nearby", () => {
    expect(routePathFor("app/api/revenue/helpers.ts")).toBeNull();
    expect(routePathFor("lib/route.ts")).toBeNull();
    expect(routePathFor("app/page.tsx")).toBeNull();
  });
});

describe("extractRepo", () => {
  const revenueRoute = `
import { NextResponse } from "next/server";
import { z } from "zod";

const query = z.object({ startDate: z.string(), endDate: z.string() });

/** Total revenue between two dates. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = query.parse({
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
  });
  return NextResponse.json({ total: 1234, currency: "USD", range: parsed });
}
`;

  it("finds a route, its method, its doc and its schema", () => {
    const summary = extractRepo([
      {
        path: "package.json",
        text: '{"name":"revenue-app","dependencies":{"next":"16"}}',
      },
      { path: "app/api/revenue/route.ts", text: revenueRoute },
    ]);

    expect(summary.packageName).toBe("revenue-app");
    expect(summary.dependencies).toContain("next");

    const route = summary.routes[0];
    expect(route?.path).toBe("/api/revenue");
    expect(route?.methods).toEqual(["GET"]);
    expect(route?.dynamic).toBe(false);
    expect(route?.doc).toContain("Total revenue");

    expect(summary.shapes.some((s) => s.kind === "zod" && s.name === "query")).toBe(true);
  });

  it("reads every exported handler on one route file", () => {
    const summary = extractRepo([
      {
        path: "app/api/customers/route.ts",
        text: "export async function GET() {}\nexport async function POST() {}\n",
      },
    ]);
    expect(summary.routes[0]?.methods).toEqual(["GET", "POST"]);
  });

  it("reads the methods a Pages handler branches on", () => {
    const summary = extractRepo([
      {
        path: "pages/api/orders.ts",
        text: `export default function handler(req, res) {
           if (req.method === "POST") return res.json({});
           res.status(405).end();
         }`,
      },
    ]);
    expect(summary.routes[0]?.methods).toEqual(["POST"]);
  });

  it("ignores a route file that exports no handler at all", () => {
    const summary = extractRepo([
      { path: "app/api/dead/route.ts", text: "const unused = 1;\n" },
    ]);
    expect(summary.routes).toHaveLength(0);
  });

  it("excludes the noise the spec names", () => {
    const summary = extractRepo([
      {
        path: "node_modules/pkg/app/api/x/route.ts",
        text: "export async function GET(){}",
      },
      { path: ".next/server/app/api/y/route.ts", text: "export async function GET(){}" },
      { path: "app/api/z/route.test.ts", text: "export async function GET(){}" },
      { path: "types/api.d.ts", text: "export interface Hidden { a: string }" },
    ]);
    expect(summary.routes).toHaveLength(0);
    expect(summary.shapes).toHaveLength(0);
  });

  it("collects exported functions and marks server actions", () => {
    const summary = extractRepo([
      {
        path: "lib/revenue.ts",
        text: `"use server";
/** Revenue for one customer. */
export async function getRevenueByCustomer(customerId: string): Promise<number> { return 0; }`,
      },
    ]);

    const fn = summary.functions[0];
    expect(fn?.name).toBe("getRevenueByCustomer");
    expect(fn?.serverAction).toBe(true);
    expect(fn?.signature).toContain("customerId: string");
    expect(fn?.doc).toContain("Revenue for one customer");
  });

  it("does not repeat route handlers in the function list", () => {
    const summary = extractRepo([
      { path: "app/api/revenue/route.ts", text: "export async function GET() {}" },
    ]);
    expect(summary.functions).toHaveLength(0);
  });

  it("says so rather than silently dropping what it could not fit", () => {
    const many = Array.from({ length: 70 }, (_, i) => ({
      path: `app/api/r${i}/route.ts`,
      text: "export async function GET() {}",
    }));
    const summary = extractRepo(many);
    expect(summary.routes).toHaveLength(60);
    expect(summary.notes.join(" ")).toContain("60 routes of 70");
  });
});
