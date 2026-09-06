import type { ReactNode } from "react";

/**
 * PageTransition — every app page arrives with the house entrance.
 *
 * A server-safe wrapper on the CSS `.rise-in` (globals.css: 0.4s, 8px,
 * --ease-out, `both`), not a framer component. The framer version cost every
 * page a client boundary to run a 0.35s tween on `easeOut` -- a fourth
 * entrance curve beside the three CSS ones -- and carried an `exit` that
 * nothing ever played, because no AnimatePresence wraps a route here. CSS is
 * the same entrance as the tiles and the drill rows, it never blocks input
 * (links are clickable at frame 0), and reduced motion kills it outright
 * through the media query the rest of the vocabulary already obeys.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  return <div className="rise-in w-full">{children}</div>;
}
