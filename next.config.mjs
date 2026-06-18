/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained build output for containerized/standalone deploys.
  output: "standalone",
  // The worker and core modules are plain Node/TS; keep server-only deps external.
  serverExternalPackages: ["pg-boss", "@prisma/client", "cheerio"],
  // The codebase uses ESM-style ".js" import specifiers that point at ".ts" sources
  // (correct for tsx/node ESM). Teach webpack to resolve them the same way.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
