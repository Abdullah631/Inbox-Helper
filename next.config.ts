import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prompts are read from disk at runtime, so make sure Vercel ships them.
  outputFileTracingIncludes: {
    "/api/classify": ["./prompts/**"],
    "/api/config": ["./prompts/**"],
    "/api/draft": ["./prompts/**"],
  },
};

export default nextConfig;
