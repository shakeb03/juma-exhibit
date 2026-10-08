import type { NextConfig } from "next";

const config: NextConfig = {
  // Shared workspace packages ship as TypeScript source.
  transpilePackages: ["@exhibit/contracts"],
};

export default config;
