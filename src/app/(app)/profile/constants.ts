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
