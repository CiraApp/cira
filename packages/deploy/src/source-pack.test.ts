import { describe, expect, it } from "vitest";
import { packSource, MAX_PACKED_BYTES } from "./source-pack.js";
import type { ArchiveEntry } from "./archive.js";

const file = (path: string, text: string, mode = 0o644): ArchiveEntry => ({
  path,
  mode,
  body: Buffer.from(text),
});

describe("packSource", () => {
  it("puts every file behind its own path", () => {
    const packed = packSource([
      file("app/main.py", "print(1)"),
      file("go.mod", "module x"),
    ]);
    expect(packed.text).toContain("--- app/main.py ---");
    expect(packed.text).toContain("print(1)");
    expect(packed.included).toEqual(["app/main.py", "go.mod"]);
  });

  // Nothing here knows what language anything is, which is the point: the
  // previous analyzer's entire failure was being Next.js-shaped.
  it("reads any language without being told about it", () => {
    const packed = packSource([
      file("main.go", "package main"),
      file("app.rb", "class App; end"),
      file("Main.java", "class Main {}"),
      file("index.php", "<?php"),
      file("app/main.py", "import fastapi"),
    ]);
    expect(packed.included).toHaveLength(5);
  });

  it("leaves out what nobody wrote", () => {
    const packed = packSource([
      file("app.py", "x = 1"),
      file("pnpm-lock.yaml", "lockfileVersion: 9"),
      file("go.sum", "hashes"),
      file("public/logo.png", "PNG"),
      file("dist/app.min.js", "!function(){}()"),
    ]);
    expect(packed.included).toEqual(["app.py"]);
  });

  it("leaves out anything that is not text, whatever it is called", () => {
    const binary: ArchiveEntry = {
      path: "model.txt",
      mode: 0o644,
      body: Buffer.from([0x68, 0x69, 0x00, 0x01, 0x02]),
    };
    expect(packSource([binary, file("a.py", "x")]).included).toEqual(["a.py"]);
  });

  /**
   * Tests are often the only place a full request path appears - Wave builds
   * its paths from a prefix constant, so `/api/v1/beats` exists nowhere but
   * its tests. They are worth reading, and worth dropping first.
   */
  it("keeps tests, but after everything else", () => {
    const packed = packSource([
      file("tests/test_beats.py", "def test(): ..."),
      file("app/beats.py", "router = ..."),
    ]);
    expect(packed.included).toEqual(["app/beats.py", "tests/test_beats.py"]);
  });

  it("stops at the budget and says what it left out", () => {
    const big = "x".repeat(400);
    const packed = packSource(
      [file("a.py", big), file("b.py", big), file("c.py", big)],
      900,
    );
    expect(packed.included.length).toBeLessThan(3);
    expect(packed.omitted.length).toBeGreaterThan(0);
    expect(packed.bytes).toBeLessThanOrEqual(900);
  });

  // One enormous file early in the alphabet should not cost every file after it.
  it("skips what will not fit rather than giving up", () => {
    const packed = packSource(
      [file("a-huge.py", "x".repeat(5000)), file("b-small.py", "ok")],
      500,
    );
    expect(packed.included).toEqual(["b-small.py"]);
    expect(packed.omitted).toEqual(["a-huge.py"]);
  });

  /**
   * This test used to assert the opposite - that the budget was *large* - and
   * asserting that is what shipped a limit no model would accept. Wave packed
   * to about 430,000 tokens against a 200,000 token context, and every
   * analysis of it failed outright with `prompt is too long`, for weeks, while
   * this test passed.
   *
   * The budget is not a measure of ambition. It is the largest request the
   * model on the other end will agree to read.
   */
  it("keeps a packed repository inside the context it is sent to", () => {
    const CONTEXT = 200_000;
    // The system prompt, and room for the answer to come back (64,000).
    const RESERVED = 67_000;
    // Source code, averaged. Dense configuration beats it, which is why the
    // budget sits below the ceiling rather than on it.
    const CHARS_PER_TOKEN = 3.5;

    expect(MAX_PACKED_BYTES / CHARS_PER_TOKEN).toBeLessThan(CONTEXT - RESERVED);
  });

  it("still reads enough of a repository to be worth doing", () => {
    // The other direction: a budget small enough to always fit is also small
    // enough to find nothing.
    expect(MAX_PACKED_BYTES).toBeGreaterThan(250_000);
  });

  /**
   * The alphabet used to decide. A repository whose docs and components
   * sorted early filled the budget before the file that declares its routes,
   * and the analysis found nothing to publish.
   */
  it("reads what declares routes first, then code, then prose, then tests", () => {
    const big = "x".repeat(60);
    const packed = packSource(
      [
        file("README.md", big),
        file(
          "app/components/Button.tsx",
          `export function Button() { return null } ${big}`,
        ),
        file("tests/test_orders.py", `client.get("/api/orders") ${big}`),
        file("zz/server.py", `@app.get("/api/orders")\ndef orders(): ... ${big}`),
      ],
      // Room for two files.
      2 * 160,
    );
    expect(packed.included).toEqual(["zz/server.py", "app/components/Button.tsx"]);
    expect(packed.omitted).toEqual(["README.md", "tests/test_orders.py"]);
  });

  it("knows a route declaration in the common frameworks", async () => {
    const { priority } = await import("./source-pack.js");
    for (const head of [
      'router.post("/refunds", handler)',
      "@router.get('/beats/{id}')",
      '@GetMapping("/orders")',
      "export async function GET(request: Request) {",
      'mux.HandleFunc("POST /inventory/{sku}", h)',
      'r.GET("/ping", ping)',
      "path('orders/<int:id>/', views.order),",
      "resources :invoices",
      "Route::get('/users', [UserController::class, 'index']);",
    ]) {
      expect(priority("src/x.any", head), head).toBe(0);
    }
    expect(priority("src/util.ts", "export const add = (a, b) => a + b;")).toBe(1);
    expect(priority("docs/guide.md", 'app.get("/x")')).toBe(2);
    expect(priority("src/orders.test.ts", 'app.get("/x")')).toBe(3);
  });
});
