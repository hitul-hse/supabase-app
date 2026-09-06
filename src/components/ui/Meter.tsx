/**
 * A bar on a FIXED 0–100 % scale, with the track always visible.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three surfaces draw the same shape and each had re-decided it: the Overview
 * hero's billable-share bar, the projects ledger's burn cell, and the mobile
 * ledger card. `StatTile`'s `progressPercent` is not reusable for any of them —
 * it is a 4px bar wired into a tile's own column layout, with the tile's tone
 * rather than a colour of its own.
 *
 * THE TWO RULES IT ENCODES
 * ------------------------
 * 1. FIXED RANGE. Apple's charts guidance is explicit that a percentage meter
 *    keeps a fixed 0–100 range (APPLE_REF §5.3), so 139 % renders a FULL bar
 *    rather than one that overflows its track or silently rescales its
 *    neighbours. The number beside it carries the overshoot; the bar carries
 *    "past the end".
 * 2. A NULL IS NOT A ZERO. `percent === null` renders the empty track and
 *    nothing else — no zero-width fill that would read as "0 % burned". The
 *    caller pairs it with "—" in the figure column. This is the same rule
 *    StatTile encodes for a missing value.
 *
 * It is a plain meter, not a `<progress>`: `<progress>` cannot be styled
 * consistently across engines, and the accessible story is the caller's — the
 * percentage is already stated in text beside every instance, so the bar itself
 * is decorative and marked `aria-hidden`.
 */
export function Meter({
  percent,
  color,
  height = 6,
  className = "",
}: {
  /** 0–100 and beyond; null when there is no basis to compute one. */
  percent: number | null;
  /** A `var(--token)` string. Callers pass a tone, never a literal hex. */
  color: string;
  /** 6 px is the house meter (§5.3); 4 px inside a tile. */
  height?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`overflow-hidden rounded-full bg-[var(--surface-2)] ${className}`}
      style={{ height }}
    >
      {percent !== null && (
        <div
          className="h-full rounded-full"
          style={{
            // Clamped at BOTH ends: a negative percentage cannot exist here,
            // and 139% is a full bar, not 139% of the track's width.
            width: `${Math.min(100, Math.max(0, percent))}%`,
            background: color,
          }}
        />
      )}
    </div>
  );
}
