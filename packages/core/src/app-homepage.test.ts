import { describe, expect, it } from "vitest";
import { normalizeHomepageUrl } from "./app-homepage.js";

describe("normalizeHomepageUrl", () => {
  it("keeps an ordinary address", () => {
    expect(normalizeHomepageUrl("https://wav3.space")).toBe("https://wav3.space/");
    expect(normalizeHomepageUrl("  https://tools.acme.test/payroll  ")).toBe(
      "https://tools.acme.test/payroll",
    );
  });

  /**
   * Half of internal software answers on a private address or a plain port,
   * and refusing those would refuse the very case this field exists for. It is
   * a link a person follows, not a request Cira makes, so none of the reasons
   * to distrust a private address apply.
   */
  it("allows the addresses internal tools actually have", () => {
    expect(normalizeHomepageUrl("http://10.0.0.8:8080/")).not.toBeNull();
    expect(normalizeHomepageUrl("https://payroll.internal")).not.toBeNull();
  });

  it("refuses a scheme that would run instead of navigate", () => {
    for (const value of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
    ]) {
      expect(normalizeHomepageUrl(value), value).toBeNull();
    }
  });

  it("refuses anything that is not an address at all", () => {
    // No scheme is the common typo, and quietly assuming https would store
    // something the person did not write.
    for (const value of ["", "   ", "wav3.space", "not a url", "https://"]) {
      expect(normalizeHomepageUrl(value), value).toBeNull();
    }
  });

  it("refuses one too long to store", () => {
    expect(normalizeHomepageUrl(`https://a.test/${"x".repeat(2100)}`)).toBeNull();
  });
});
