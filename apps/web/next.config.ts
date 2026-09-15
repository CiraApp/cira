import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cira/core", "@cira/db"],
  typedRoutes: true,
};

export default config;
