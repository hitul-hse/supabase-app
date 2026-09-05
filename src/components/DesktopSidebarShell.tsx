"use client";

/**
 * DesktopSidebarShell — the animating wrapper that collapses the sidebar down
 * to an icon rail.
 *
 * The server-rendered <Sidebar/> tree is passed in as `children` so it keeps
 * doing its own auth/profile fetching; this component only owns the geometry
 * and publishes the collapsed flag.
 *
 * WHY A RAIL AND NOT WIDTH 0
 * An earlier version animated to width 0. It worked, but collapsing threw away
 * every wayfinding cue at once: no icons, no active-section marker, no logout,
 * and exactly one 8px button at the page edge as the way back. The rail keeps
 * navigation usable at a third of the width, which is the actual point of
 * collapsing.
 *
 * HOW THE INNER CONTENT KNOWS
 * `data-collapsed` is set HERE rather than read from context by each child,
 * because <Sidebar/> is an async SERVER component and cannot consume a client
 * context at all. Descendants style themselves with `group-data-[collapsed=…]`
 * variants off this element.
 *
 * That attribute is also why there is no flash: this component's very first
 * render -- on the server -- already has the real value, because the provider
 * seeds its state from the request cookie. Compare `<html data-sidebar-
 * collapsed>`, which the provider only sets in an effect and is therefore
 * wrong until hydration; do not reach for that one to drive layout.
 *
 * THE MOTION SEAM (for the motion stage; APPLE_REF §6.2 "Sidebar collapse")
 * -------------------------------------------------------------------------
 * The layout stage arranged the pane so that this element's `width` is the
 * ONE layout property the collapse animates -- everything inside it is either
 * static or opacity:
 *
 *   - `animate={{ width }}` below is the single width. Rows are `w-full` of
 *     the pane, so they narrow on the same curve; §6.2 wants this as CSS
 *     (220 → 64 over 220 ms `--ease-out`) or keeps the spring -- either way
 *     it stays ONE transition. The gate (check-sidebar-collapse.mjs) reads
 *     `width:64px` off this element's server-rendered markup, which
 *     `initial={false}` guarantees; keep an inline width in whatever replaces
 *     this.
 *   - Rows are 32 px tall in BOTH states and keep `px-3` in both, so no row
 *     changes height or inner padding at the flip (SidebarNav.tsx).
 *   - The pane's own inset flips 4 → 12 px (`px-1` ↔ `px-3` on the header,
 *     nav and foot wrappers in Sidebar.tsx). That is the ONLY horizontal
 *     geometry that changes, and it moves the icon column 24 → 32. To make
 *     the collapse transform-only inside the pane, animate that 8 px as a
 *     translate (framer `layout="position"` on the row's icon, or a
 *     `translateX` driven by the same curve) -- the padding value itself is
 *     otherwise a discrete flip, hidden under the moving edge.
 *   - Labels: `group-data-[collapsed=true]/sidebar:opacity-0` (+ `w-0`, which
 *     the gate pins) on the label span -- opacity is the only thing to time
 *     (§6.2: 120 ms). The toggle moves column at the flip (trailing edge →
 *     under the mark); it is the element the user just pressed.
 *   - The brand mark, group hairlines and the connection dot are already on
 *     the icon column in both states.
 */

import { motion, useReducedMotion } from "framer-motion";
import { SPRING_MOVE } from "./animations/springs";
import { useSidebarCollapse } from "./SidebarCollapseContext";
import { SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH } from "./sidebar-collapse-shared";

export function DesktopSidebarShell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebarCollapse();
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      id="app-sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      /*
        `overflow-hidden` only while EXPANDED. It stops the 220px content
        spilling out mid-animation, which matters on the way in and out.

        In the rail it has to go: the tooltips are positioned just past the
        64px edge, and a clipping box here severs them at exactly the point
        they become the only way to read a label. The animation still looks
        right because at 64px the content already fits.
      */
      className="group/sidebar hidden flex-none overflow-hidden lg:block data-[collapsed=true]:overflow-visible"
      // `initial={false}` so the very first paint uses the real width straight
      // away. Without it, a collapsed-by-cookie sidebar would animate open->shut
      // on every page load, which is precisely the flash the cookie exists to
      // prevent.
      initial={false}
      animate={{ width: collapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : // A spring, not a tween: Ctrl+B pressed mid-flight re-targets from
            // the width the panel is actually at, carrying its velocity, instead
            // of restarting a 0.26s curve from wherever it was. Apple's
            // "move / reposition" values (damping 1.0, response 0.4).
            SPRING_MOVE
      }
    >
      {/*
        The panel fills whatever width the shell currently has, so labels fade
        and icons re-centre as it animates. The old build pinned an inner 220px
        box and slid it out of view; that cannot work for a rail, where the
        content has to actually reflow.
      */}
      <div className="h-full w-full">{children}</div>
    </motion.div>
  );
}
