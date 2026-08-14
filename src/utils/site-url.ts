/**
 * Absolute base URL for links that leave the app and come back — invite and
 * password-reset emails, chiefly.
 *
 * These cannot be relative: Supabase embeds them in an email, so "/auth/..."
 * would resolve against nothing. Getting this wrong is how an invited
 * colleague ends up staring at a localhost link they can't open, which is
 * exactly what happens if you let Supabase fall back to the project's Site
 * URL while that's still pointed at a dev machine.
 *
 * Order matters: an explicit NEXT_PUBLIC_SITE_URL always wins, so production
 * can be pinned to the real domain regardless of which Vercel deployment
 * serves the request. VERCEL_URL is the per-deployment hostname (a preview
 * URL on previews), which is a reasonable fallback but not a stable identity.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return stripTrailingSlash(explicit);

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${stripTrailingSlash(vercel)}`;

  return "http://localhost:3000";
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
