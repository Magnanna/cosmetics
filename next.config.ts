import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  // Logos are resized in the browser first; this leaves headroom for large PNGs.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
};

export default nextConfig;
