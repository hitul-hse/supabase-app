"use client";

/**
 * DesktopSidebarShell — the animating wrapper that actually hides the sidebar.
 *
 * The server-rendered <Sidebar/> tree is passed in as `children` so it keeps
 * doing its own auth/profile fetching; this component only owns the geometry.
 *
 * It collapses to width 0 rather than unmounting the children. Unmounting would
 * throw away the sidebar's scroll position, restart every entry animation in
 * SidebarNav on each reopen, and -- because <Sidebar/> is an async server
 * component -- risk a fresh round trip just to show a panel the user already
 * had. Animating the width keeps reopening instant.
 *
 * `overflow-hidden` is load-bearing: at width 0 the 220px-wide content would
 * otherwise still paint over the page.
 */

import { motion } from "framer-motion";
import { useSidebarCollapse } from "./SidebarCollapseContext";
import { SIDEBAR_WIDTH } from "./sidebar-collapse-shared";

export function DesktopSidebarShell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebarCollapse();

  return (
    <motion.div
      id="app-sidebar"
      // `initial={false}` so the very first paint uses the real width straight
      // away. Without it, a collapsed-by-cookie sidebar would animate open->shut
      // on every page load, which is precisely the flash the cookie exists to
      // prevent.
      initial={false}
      animate={{ width: collapsed ? 0 : SIDEBAR_WIDTH }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className="hidden flex-none overflow-hidden lg:block"
      // Hide the collapsed panel from assistive tech and from tab order --
      // width:0 alone leaves every link focusable, so a keyboard user would
      // tab through a dozen invisible nav items.
      aria-hidden={collapsed}
      // `inert` is the only thing that reliably removes descendants from the
      // tab order; React 19 supports it as a real boolean attribute.
      inert={collapsed}
    >
      {/*
        Fixed inner width. Without it the sidebar's own content would reflow
        as the outer width animates, so every label would squeeze and wrap on
        the way shut instead of sliding cleanly out of view.
      */}
      <div style={{ width: SIDEBAR_WIDTH }} className="h-full">
        {children}
      </div>
    </motion.div>
  );
}
