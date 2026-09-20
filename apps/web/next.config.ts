import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@infi90/core",
    "@infi90/parsers",
    "@infi90/renderers",
    "@infi90/exporters",
    "@infi90/cad-engine",
  ],
  serverExternalPackages: ["exceljs", "adm-zip"],
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
