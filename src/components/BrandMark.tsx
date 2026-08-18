/**
 * BrandMark — the HSE logo as vector geometry, with an optional assemble
 * animation modelled on the reference logomark motion (four pieces sliding in
 * from the four edges and settling into the mark).
 *
 * WHY THIS IS SVG AND NOT THE PNG
 * `/hse-logo.png` is a 499x499 raster silhouette. A raster cannot be animated
 * piece-wise, cannot be recoloured by token, and blurs at 2x. The geometry
 * below was measured off that PNG's own alpha mask by scanline decomposition
 * (see the geometry gate) and agrees with it on 99.995% of pixels — 4 pixels of
 * antialiasing out of 79,510 — so this is the same mark, not a redraw of it.
 *
 * WHERE IT ANIMATES, AND WHERE IT DELIBERATELY DOES NOT
 * The frequency tier decides, not taste:
 *   - sidebar (seen on every one of ~10 module pages, all day)  -> STATIC
 *   - portal header (seen on every return to the hub)           -> STATIC
 *   - sign-in / auth pages (first-time, rare, a real threshold) -> ANIMATED
 * Animating the sidebar mark would replay a 900ms flourish on every navigation,
 * which stops being delight after the second time and starts being a stutter in
 * the middle of someone's work. `animate` is therefore opt-in per mount, and the
 * default is off.
 */
import type { CSSProperties } from "react";

/**
 * The mark, decomposed into the four pieces the animation moves independently.
 *
 * Coordinates are viewBox units in a 367x341 box, measured off the PNG by
 * scanline decomposition: image-space x=67..433, y=80..420. (The asset also
 * carries a 2px speck at y=78-79 above the mark, which is not part of it.)
 *
 * Two pieces are L-shaped: the top bar keeps its left descender and the bottom
 * bar keeps its right ascender. Those stubs are what make the mark read as an
 * "S" rather than as three loose bars, so they travel with their bar.
 */
const PIECES = [
  {
    id: "top",
    // top bar (y 80..154) + left descender (y 155..183)
    d: "M0 0H367V75H75V104H0Z",
    /** Enters from above: it is the topmost piece, so it falls into place. */
    from: "translateY(-46%)",
  },
  {
    id: "mid-left",
    // y 214..286
    d: "M0 134H146V207H0Z",
    /** Enters from the left edge it sits against. */
    from: "translateX(-64%)",
  },
  {
    id: "mid-right",
    // y 214..286
    d: "M221 134H367V207H221Z",
    /** Mirrors mid-left, from the right. */
    from: "translateX(64%)",
  },
  {
    id: "bottom",
    // right ascender (y 317..345) + bottom bar (y 347..420)
    d: "M293 237H367V341H0V267H293Z",
    /** Enters from below, mirroring the top piece. */
    from: "translateY(46%)",
  },
] as const;

/**
 * Per-piece stagger. The eye should read four arrivals, not one lump: 70ms is
 * inside the 30-80ms band that reads as a sequence without feeling queued.
 */
const STAGGER_MS = 70;

export type BrandMarkProps = {
  /** Rendered size in px (square). */
  size?: number;
  /**
   * Play the assemble animation on mount. Off by default — see the frequency
   * note above. Only turn this on for rare, first-time surfaces.
   */
  animate?: boolean;
  /**
   * Repeat the assemble on a slow cycle instead of playing once.
   *
   * Requires `animate`. Reserved for the large hero mark on the sign-in page:
   * a loop is only acceptable on a surface where there is nothing to read and
   * no work to interrupt. Never set this inside the app — a perpetual animation
   * beside content people are reading is a permanent attention tax, and on a
   * laptop it is also a permanent battery cost.
   */
  loop?: boolean;
  /**
   * Accessible name. Omit (or pass "") for a decorative mark that sits beside a
   * visible "HSE HUB" wordmark, which is the usual case — announcing "HSE Logo"
   * next to text that already says HSE HUB is noise for a screen reader.
   */
  title?: string;
  className?: string;
};

export function BrandMark({
  size = 26,
  animate = false,
  loop = false,
  title,
  className,
}: BrandMarkProps) {
  const labelled = Boolean(title);
  const looping = animate && loop;

  return (
    <svg
      viewBox="0 0 367 341"
      width={size}
      height={size}
      className={className}
      data-testid="brand-mark"
      data-animated={animate ? "true" : "false"}
      data-loop={looping ? "true" : "false"}
      // The mark is wider than it is tall; without this it would stretch to fill
      // a square box.
      preserveAspectRatio="xMidYMid meet"
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {PIECES.map((piece, i) => (
        <path
          key={piece.id}
          d={piece.d}
          // Token, not a hex literal: the mark then follows the brand accent
          // wherever it is used, and cannot drift from it.
          fill="var(--accent)"
          data-piece={piece.id}
          className={
            looping ? "brand-mark__piece--loop" : animate ? "brand-mark__piece" : undefined
          }
          style={
            animate
              ? ({
                  // Custom property rather than a hardcoded keyframe per piece:
                  // one @keyframes rule drives all four, each reading its own
                  // start transform.
                  "--piece-from": piece.from,
                  animationDelay: `${i * STAGGER_MS}ms`,
                } as CSSProperties)
              : undefined
          }
        />
      ))}
    </svg>
  );
}
