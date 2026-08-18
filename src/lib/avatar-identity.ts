/**
 * Pure identity helpers behind the Avatar component, split out so
 * scripts/check-avatar-monogram.mjs can import them directly under
 * `node --experimental-strip-types` — that runtime cannot process JSX or
 * resolve next/image, both of which the Avatar component itself pulls in.
 *
 * The monogram is not a placeholder — most accounts will never upload a
 * photo, so this is the normal state and has to look designed. Colour is
 * derived from the name so it is stable across sessions and devices; a hue
 * that changed per render would read as a rendering bug.
 */

/** First and last initial. Middle names are dropped: "L. van der Berg" reads as LB. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const PALETTE = ["var(--accent)", "var(--good)", "var(--warning)", "var(--viz-series-1)"];

/** Deterministic palette pick, so one person is always the same colour. */
export function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
