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
 * THE MOTION (APPLE_REF §6.2 "Sidebar collapse ↔ rail")
 * -----------------------------------------------------
 * One CSS transition, on `width`, 220 ms on `--ease-out`, on this element and
 * nothing else. The content column is a flex sibling, so it reflows on the
 * same curve for free -- there is no second animation to keep in step.
 *
 * WIDTH, KNOWINGLY. The compositor rule (apple-design §11; §6.1 #8 "never
 * animate row height or width") is the default here, and this is its one
 * ruled exception: a sidebar collapse IS a change of the content column's
 * width, and a transform cannot deliver that -- a rail slid in on
 * `translateX` either overlaps the first 156 px of the page or leaves them
 * empty until the layout snaps. Apple's own split view animates the divider,
 * i.e. layout. §6.2 rules the width transition in and sets the guard as a
 * measurement rather than a property list: one transition, max frame under
 * 32 ms (measured 16.8 ms on /projects and on /my-work at 1440 × 900, 44
 * rAF ticks each, through scripts/lib/launch-chromium.mjs; the move takes 12
 * frames, 220 ms). Inside the pane the collapse is transform and opacity
 * only, plus the pane's own inset on this same curve (Sidebar.tsx): rows are
 * 32 px in both states, the icon column travels its 8 px at ≤ 2.5 px a frame
 * where it used to jump the whole 8 in one, and labels fade 120 ms
 * (SidebarNav.tsx).
 *
 * CSS, not a spring, because §6.2 says so and because nothing about it is
 * gesture-driven: a transition re-targets from the current computed value
 * when Ctrl+B is pressed mid-flight (measured: the width keeps stepping
 * 17 px a frame through the reversal, no restart), and the global
 * `prefers-reduced-motion` rule in globals.css makes it instant (measured:
 * the first changed frame is the resting one), which is exactly §6.2's
 * reduced-motion value. The gate (check-sidebar-collapse.mjs) reads
 * `width:64px` off this element's server-rendered markup; the inline style
 * keeps that true with no client-side step in between.
 */

import { useSidebarCollapse } from "./SidebarCollapseContext";
import { SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH } from "./sidebar-collapse-shared";

export function DesktopSidebarShell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebarCollapse();

  return (
    <div
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
      className="group/sidebar hidden flex-none overflow-hidden transition-[width] duration-220 lg:block data-[collapsed=true]:overflow-visible"
      style={{ width: collapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH }}
    >
      {/*
        The panel fills whatever width the shell currently has, so labels fade
        and icons re-centre as it animates. The old build pinned an inner 220px
        box and slid it out of view; that cannot work for a rail, where the
        content has to actually reflow.
      */}
      <div className="h-full w-full">{children}</div>
    </div>
  );
}
