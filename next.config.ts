import type { NextConfig } from "next";

// Sent on every response, pages and API alike. The Content-Security-Policy is set per
// request in middleware.ts because it carries a nonce. Vercel adds HSTS itself.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Prompts are read from disk at runtime, so make sure Vercel ships them.
  outputFileTracingIncludes: {
    "/api/classify": ["./prompts/**"],
    "/api/draft": ["./prompts/**"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
