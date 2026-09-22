import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESERVED_SPACE_SLUGS } from "@cira/core";

/**
 * Every page Cira has at the top level, read from this folder, is an address
 * no space may take. A space called Docs used to get `/docs` and could never
 * be reached, because the page wins. Reading the folder means a new page
 * cannot be added without this failing until it is reserved.
 */
describe("top-level routes", () => {
  it("are all reserved from being a space's address", () => {
    const here = new URL(".", import.meta.url).pathname;
    const routes = readdirSync(here, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      // Dynamic segments, route groups and dot-folders are not addresses.
      .filter((name) => !/^[[(.]/.test(name));

    expect(routes.length).toBeGreaterThan(5);
    for (const route of routes) expect(RESERVED_SPACE_SLUGS.has(route), route).toBe(true);
    // Not a folder, but an address all the same: Sentry's tunnel.
    expect(RESERVED_SPACE_SLUGS.has("monitoring")).toBe(true);
  });
});
