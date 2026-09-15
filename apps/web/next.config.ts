import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cira/core", "@cira/db", "@cira/deploy", "@cira/extract"],
  typedRoutes: true,
};

export default config;
