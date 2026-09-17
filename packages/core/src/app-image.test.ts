import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, normalizeAppImage } from "./app-image.js";

const dataUrl = (type: string, bytes: number) =>
  `data:${type};base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;

describe("normalizeAppImage", () => {
  it("keeps a picture", () => {
    for (const type of ["image/webp", "image/png", "image/jpeg"]) {
      expect(normalizeAppImage(dataUrl(type, 4000)), type).not.toBeNull();
    }
  });

  it("treats an empty choice as no picture", () => {
    expect(normalizeAppImage("")).toBeNull();
    expect(normalizeAppImage("   ")).toBeNull();
  });

  /**
   * What is stored ends up in a `src` on everybody else's screen. A data URL
   * that is not an image is not dangerous in an `img`, but trusting the shape
   * of a string because a form sent it is the habit worth not having.
   */
  it("refuses anything that is not a picture", () => {
    for (const value of [
      dataUrl("text/html", 100),
      dataUrl("image/svg+xml", 100),
      "https://example.test/logo.png",
      "javascript:alert(1)",
      "data:image/png;base64,not base64!",
      "data:image/png,plain",
    ]) {
      expect(normalizeAppImage(value), value).toBeNull();
    }
  });

  it("refuses one too large to keep in a row", () => {
    expect(normalizeAppImage(dataUrl("image/webp", MAX_IMAGE_BYTES + 1024))).toBeNull();
    expect(
      normalizeAppImage(dataUrl("image/webp", MAX_IMAGE_BYTES - 1024)),
    ).not.toBeNull();
  });

  it("measures what it decodes to, not how long the text is", () => {
    // Base64 carries four characters for every three bytes, so judging the
    // string's length would refuse a picture a third smaller than the ceiling.
    const justUnder = dataUrl("image/webp", MAX_IMAGE_BYTES - 8);
    expect(justUnder.length).toBeGreaterThan(MAX_IMAGE_BYTES);
    expect(normalizeAppImage(justUnder)).not.toBeNull();
  });
});
