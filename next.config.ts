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

  // Build output directory. Defaults to .next; a test harness can point it
  // elsewhere via NEXT_ACCEPTANCE_DIST.
  //
  // This exists because scripts/check-server-action-auth.mjs must build the app
  // against a stub Supabase (NEXT_PUBLIC_* are compile-time constants, so there
  // is no way to redirect them at runtime). Its first version moved .next aside
  // and put it back, which was wrong twice over: on Windows the rename hits EPERM
  // while any handle is open, and parallel sessions run their own servers out of
  // .next, so swapping it can destroy another agent's build. A separate distDir
  // touches nothing shared.
  //
  // Unset in every normal path -- dev, CI and Vercel all get .next.
  distDir: process.env.NEXT_ACCEPTANCE_DIST || ".next",
  // Surfaces server-side errors to the client during development, and keeps
  // the build output lean in production.
  reactStrictMode: true,

  // ─── Deployment skew: keep an open tab talking to the build it was served ──
  //
  // THE REPORTED BUG. While recording the org chart ("Björn is CEO, everyone
  // reports to him"), saving a reporting line made the page break and ask for a
  // reload. The org chart itself was not at fault: single edits, deep trees,
  // reporting loops, and five saves in a row were all driven through the live site
  // without a single failure. What does fail is skew.
  //
  // A Server Action is addressed by an opaque ID baked into the JS bundle at BUILD
  // time. Every deploy mints new IDs. A tab loaded before a deploy still holds the
  // old ones, so its next save reaches a server that has never heard of that action,
  // and Next.js can only tell the user to reload -- losing whatever they were doing.
  //
  // MEASURED, not assumed. An authenticated POST to /people carrying a
  // correctly-shaped but unknown action id returns, against production:
  //
  //     HTTP 404, x-nextjs-action-not-found=1, body "Server action not found."
  //
  // Six deploys landed during that editing session, so this was near-certain to hit
  // somebody with the page open, and it did.
  //
  // THE FIX. Pinning deploymentId makes every request from a bundle carry the
  // deployment that produced it, so Vercel can route it back to that deployment
  // rather than the newest one, and an open tab keeps working across a deploy. Read
  // from VERCEL_DEPLOYMENT_ID rather than hardcoded; locally it is undefined, which
  // is the correct value for a single dev server.
  //
  // This requires Skew Protection to be enabled on the Vercel project for the
  // routing half to take effect. Until then the setting is harmless and the failure
  // stays what it was: rare, tied to deploy timing, and cured by a reload.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,

  // Lets next/image render the signed avatar URL from the private `avatars`
  // storage bucket (see src/app/(app)/profile/page.tsx).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/sign/**" },
    ],
  },

  // Next's default Server Action body limit is 1 MB. uploadAvatar's own
  // ceiling is MAX_AVATAR_BYTES (2 MB, see profile/constants.ts) -- without
  // raising this, a 1.2-1.9 MB photo would be killed with an unhandled 413
  // before uploadAvatar's own size check ever ran, so the user would never
  // see "That image is over 2 MB." 3 MB covers a 2 MB file plus multipart
  // overhead while keeping MAX_AVATAR_BYTES as the real, enforced ceiling.
  experimental: {
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },

  // NOTE: do NOT add an `env: { NEXT_PUBLIC_SITE_URL: ... }` block here.
  // A previous version did, and its `A ?? B ? C : D` expression parsed as
  // `(A ?? B) ? C : D` — so whenever NEXT_PUBLIC_SITE_URL *was* set it got
  // thrown away and replaced with the per-deployment VERCEL_URL, which is
  // what invite/reset emails are built from. Site URL resolution belongs to
  // getSiteUrl() in src/utils/site-url.ts, which reads the raw env vars in
  // the correct precedence. Inlining it here only shadows that helper.

  // The showcase aliases all resolve to /demo, the one public marketing page.
  async redirects() {
    return [
      { source: "/video",        destination: "/demo", permanent: false },
      { source: "/showcase",     destination: "/demo", permanent: false },
      { source: "/product-tour", destination: "/demo", permanent: false },
      { source: "/hub",          destination: "/demo", permanent: false },
    ];
  },

  // Correct MIME types and cache headers for media assets.
  async headers() {
    return [
      // ─── Baseline hardening ────────────────────────────────────────────
      // Measured 2026-08-31: production served only Strict-Transport-Security
      // (Vercel adds that itself). The rest below close the classic gaps:
      // clickjacking (nothing on this portal is meant to be iframed), MIME
      // sniffing, referrer leakage of authenticated URLs to third parties,
      // and browser features no page here uses. A full Content-Security-Policy
      // is deliberately NOT set in this pass: Next inlines styles and scripts,
      // so a strict CSP needs nonce plumbing and its own test cycle rather
      // than a config drive-by.
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/:path*.webm",
        headers: [
          { key: "Content-Type", value: "video/webm" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/:path*.mp4",
        headers: [
          { key: "Content-Type", value: "video/mp4" },
          { key: "Accept-Ranges", value: "bytes" },
          { key: "Cache-Control", value: "public, max-age=86400" },
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
