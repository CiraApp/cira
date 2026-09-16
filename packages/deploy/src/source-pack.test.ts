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

  it("has a budget big enough for a real repository", () => {
    // Wave's API is ~553 KB of Python; Cira's whole source is ~737 KB.
    expect(MAX_PACKED_BYTES).toBeGreaterThan(900_000);
  });
});
