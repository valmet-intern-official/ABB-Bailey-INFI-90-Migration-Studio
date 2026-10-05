import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@infi90/core",
    "@infi90/parsers",
    "@infi90/renderers",
    "@infi90/exporters",
    "@infi90/cad-engine",
    "@infi90/cad-forensics",
    "@infi90/m1-engine",
    "@infi90/function-codes",
    "@infi90/fb-spec",
  ],
  serverExternalPackages: ["exceljs", "adm-zip", "sharp", "xlsx"],
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
