import type { NextConfig } from "next";

const internalApiHostport = process.env.INTERNAL_API_HOSTPORT;
const internalApiBaseUrl = internalApiHostport
  ? `http://${internalApiHostport}`
  : process.env.NEXT_SERVER_API_BASE_URL;

const nextConfig: NextConfig = {
  reactCompiler: true,
  async rewrites() {
    if (!internalApiBaseUrl) {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${internalApiBaseUrl}/api/:path*`,
      },
      {
        source: "/media/:path*",
        destination: `${internalApiBaseUrl}/media/:path*`,
      },
      {
        source: "/health",
        destination: `${internalApiBaseUrl}/health`,
      },
    ];
  },
};

export default nextConfig;
