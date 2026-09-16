import { describe, expect, it } from "vitest";
import { checkBundle, shouldUpload, type BundleFile } from "./bundle.js";

describe("shouldUpload", () => {
  it("takes ordinary source", () => {
    for (const p of [
      "package.json",
      "src/app/page.tsx",
      "public/logo.svg",
      "README.md",
    ]) {
      expect(shouldUpload(p)).toBe(true);
    }
  });

  it("never uploads dependencies or build output, at any depth", () => {
    for (const p of [
      "node_modules/react/index.js",
      "apps/web/node_modules/x/y.js",
      ".next/server/page.js",
      "dist/index.js",
      ".git/config",
      ".vercel/project.json",
      ".cira/project.json",
    ]) {
      expect(shouldUpload(p)).toBe(false);
    }
  });

  it("never uploads local secrets", () => {
    for (const p of [".env", ".env.local", ".env.production", "apps/web/.env.local"]) {
      expect(shouldUpload(p)).toBe(false);
    }
  });

  it("keeps the example env file, which is documentation not secrets", () => {
    expect(shouldUpload(".env.example")).toBe(true);
  });

  it("drops logs and build caches", () => {
    for (const p of ["debug.log", "tsconfig.tsbuildinfo", ".DS_Store"]) {
      expect(shouldUpload(p)).toBe(false);
    }
  });

  it("rejects an empty path rather than guessing", () => {
    expect(shouldUpload("")).toBe(false);
    expect(shouldUpload("/")).toBe(false);
  });
});

describe("checkBundle", () => {
  const file = (path: string, size: number): BundleFile => ({ path, size });

  it("accepts an ordinary project", () => {
    expect(checkBundle([file("package.json", 900), file("src/a.ts", 4000)]).ok).toBe(
      true,
    );
  });

  it("refuses an empty folder with a sentence, not a crash", () => {
    const v = checkBundle([]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("nothing to deploy");
  });

  it("names the offending file when one is too big", () => {
    const v = checkBundle([file("assets/video.mp4", 40 * 1024 * 1024)]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("assets/video.mp4");
  });

  it("refuses a folder that is too big overall", () => {
    const many = Array.from({ length: 200 }, (_, i) => file(`f${i}`, 1024 * 1024));
    const v = checkBundle(many);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("100 MB");
  });
});
