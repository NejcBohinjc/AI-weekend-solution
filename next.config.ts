import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@node-rs/argon2", "nodemailer"],
  // Admins upload calendar exports (.ics) through a server action; a year of meetings can exceed the 1 MB default.
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
    // Never reuse a dynamic page from the client router cache on link navigation (the default, made explicit:
    // the timer and tasks show live state). Browser Back still may; TimerCard refreshes itself then.
    staleTimes: { dynamic: 0 },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Setup links carry a secret token in the URL; never leak it via Referer.
      { source: "/set-password", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
