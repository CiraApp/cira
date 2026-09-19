import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cira/core", "@cira/db", "@cira/deploy"],
  typedRoutes: true,
};

/**
 * Source maps go to Sentry at the end of a production build, so a reported
 * error points at Cira's own code rather than a minified bundle, and are then
 * deleted rather than served. The token that allows the upload is a CI secret;
 * a build without it, locally or in the test job, skips the upload entirely.
 */
const uploadToken = process.env["SENTRY_AUTH_TOKEN"];

export default withSentryConfig(config, {
  org: "cira",
  project: "cira-web",
  ...(uploadToken === undefined ? {} : { authToken: uploadToken }),
  sourcemaps: { disable: uploadToken === undefined || uploadToken === "" },
  widenClientFileUpload: true,
  // Reports from the browser go through Cira's own domain, where an ad
  // blocker will not stop them.
  tunnelRoute: "/monitoring",
  silent: process.env["CI"] === undefined,
  telemetry: false,
});
