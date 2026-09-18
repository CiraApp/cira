import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same JSX runtime Next compiles with. The classic one expects `React`
  // in scope, which no component here imports, so without this nothing that
  // renders could be tested.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    alias: {
      // `server-only` exists to fail a build that imports server code into a
      // client bundle. Under vitest there is no bundle and nothing to protect,
      // and without this the modules it guards cannot be tested at all.
      "server-only": new URL("./test/server-only.ts", import.meta.url).pathname,
      "@": new URL("./apps/web/src", import.meta.url).pathname,
    },
  },
});
