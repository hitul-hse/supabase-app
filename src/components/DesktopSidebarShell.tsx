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
 */

import { motion, useReducedMotion } from "framer-motion";
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
          : // Exponential ease-out: quick to commit, slow to settle. Matches the
            // curve DESIGN.md pins for the rest of the app.
            { duration: 0.26, ease: [0.23, 1, 0.32, 1] }
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
