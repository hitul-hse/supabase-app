import type { NextConfig } from "next";

// ─── Build-time environment variable validation ───────────────────────────────
// Fail the build loudly if the required Supabase keys are missing.
// This catches a misconfigured Vercel project or a missing .env.local before
// the app ships, rather than failing silently at runtime when a user hits a
// protected route. The CI workflow supplies stub values so the build job can
// reach this check without needing the real secrets.
const requiredEnvVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(
      `[next.config.ts] Missing required environment variable: ${key}\n` +
      `Set it in .env.local for local dev, or in your Vercel project settings for production.`,
    );
  }
}

const nextConfig: NextConfig = {
  // Surfaces server-side errors to the client during development, and keeps
  // the build output lean in production.
  reactStrictMode: true,


  // Expose the site's own URL as a typed env var for redirects, invite links,
  // etc. NEXT_PUBLIC_SITE_URL is set in Vercel; falls back to localhost in dev.
  env: {
    NEXT_PUBLIC_SITE_URL:
      process.env.NEXT_PUBLIC_SITE_URL ??
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000",
  },

  // /showcase is an alias for /demo (Turbopack route-discovery workaround).
  async redirects() {
    return [
      { source: "/showcase", destination: "/demo", permanent: false },
    ];
  },

  // Serve .webm files with the correct MIME type so browsers play them inline.
  async headers() {
    return [
      {
        source: "/:path*.webm",
        headers: [
          { key: "Content-Type", value: "video/webm" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/screenshots/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
    ];
  },
};

export default nextConfig;
