/**
 * Plain constants shared by actions.ts and its client components.
 *
 * A module carrying the "use server" directive may only export async
 * functions -- Next.js fails the build on any other export. These values
 * (and the ProfileActionState type, which is erased at compile time anyway)
 * live here instead of in actions.ts so both the server action and the
 * client-side pre-check import the same single source of truth.
 */

export const MAX_AVATAR_BYTES = 2_097_152; // 2 MB
export const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type ProfileActionState = { status: "idle" | "success" | "error"; message?: string };

// These two lists MUST match the check constraints Task 1 applied to
// app_user_profile in the live database exactly. A value that passes here and
// fails there surfaces as an unexplained database error in the UI.
//   pref_landing_page CHECK (pref_landing_page = ANY (ARRAY['/', '/people', '/projects', '/timesheets', '/time/dashboard', '/leave']))
//   pref_locale       CHECK (pref_locale = ANY (ARRAY['de-DE', 'en-GB']))
export const LANDING_PAGES = [
  { value: "/", label: "Overview" },
  { value: "/people", label: "People" },
  { value: "/projects", label: "Projects" },
  { value: "/timesheets", label: "Timesheets" },
  { value: "/time/dashboard", label: "TrackingTime Dashboard" },
  { value: "/leave", label: "Leave & Time Off" },
];

export const LOCALES = [
  { value: "de-DE", label: "German (24h, 31.12.2026)" },
  { value: "en-GB", label: "English (24h, 31/12/2026)" },
];
