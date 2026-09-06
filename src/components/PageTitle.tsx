"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The page `h1` for `PageHeader`, with a native tooltip only while the text
 * is actually clipped.
 *
 * The house form for a name that overruns its row is end truncation plus a
 * `title` attribute so the full text is still reachable (APPLE_REF §8 #17).
 * The attribute is not free, though: a heading that fits and carries a
 * tooltip repeating itself is noise on hover, and §5.8 rules that a tooltip
 * "never repeats the control's name". So the attribute follows the geometry:
 * set while `scrollWidth > clientWidth`, absent otherwise. Measured before
 * this component: "Projects" at 1440 px carried title="Projects".
 *
 * A client component because the decision is a measurement. It is a plain
 * `<h1>` on the server (no attribute), and after hydration a ResizeObserver
 * on the heading itself keeps the attribute honest through viewport resizes,
 * the sidebar collapsing (the row widens) and a locale switch (the text
 * changes; the effect re-runs on `title`). ResizeObserver delivers one
 * notification on `observe()`, so the first measurement happens there and
 * nothing sets state synchronously inside the effect. Poppins arriving
 * after hydration widens the text without resizing a truncated box, so
 * `document.fonts.ready` re-measures once as well.
 *
 * PageHeader (a server component) owns the class string, so the type role
 * stays where check-design-system reads it.
 */
export function PageTitle({ title, className }: { title: string; className: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const measure = () => {
      if (live) setClipped(el.scrollWidth > el.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    document.fonts?.ready.then(measure, () => {});
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [title]);

  return (
    <h1 ref={ref} title={clipped ? title : undefined} className={className}>
      {title}
    </h1>
  );
}
