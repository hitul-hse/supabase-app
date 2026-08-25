"use client";

/**
 * MobileSidebar — client shell that owns the open/close state for the mobile
 * slide-in drawer. Renders a hamburger button in the top bar and wraps the
 * sidebar content with a backdrop + slide-in panel. Used exclusively on small
 * screens (hidden on lg+). The actual nav content is passed as children so the
 * server-side Sidebar async component can keep fetching user/role data.
 */

import { useState, useEffect } from "react";
import { MobileTabBar } from "./MobileTabBar";
import { BrandMark } from "./BrandMark";

interface MobileSidebarProps {
  children: React.ReactNode;
  /** Role key, for filtering the bottom tab bar the same way the sidebar is
   *  filtered. Resolved server-side in the layout. */
  roleKey?: string | null;
}

/* MobileSidebarToggle (the top-left hamburger) was deleted with the bottom tab
   bar, not merely unmounted: it had one caller, and leaving an exported
   component nobody renders invites somebody to put it back beside the tab bar
   — two controls, opposite corners, opening the same drawer. "More" is the one
   way in now. */

export function MobileSidebarDrawer({ children, roleKey = null }: MobileSidebarProps) {
  const [open, setOpen] = useState(false);

  // Close on route change (pathname shift detected via popstate / pushstate)
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, []);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      {/*
        Mobile top bar. The hamburger is GONE from it: the bottom tab bar now
        owns navigation, and two controls opening the same drawer from opposite
        corners is a second way to do one thing. What is left is a title bar —
        it still says where you are, and `pt-12` in the layout already reserves
        its space.

        pt-[env(safe-area-inset-top)] for the notch: without it the title sits
        under the status bar in a home-screen/standalone context.
      */}
      <div className="fixed top-0 left-0 right-0 z-30 flex h-12 items-center gap-2.5 border-b border-[var(--border)] bg-[var(--sidebar)] px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        {/*
          THE MARK, not just the words. Below `lg` the sidebar is a drawer and
          the desktop lockup never renders, so before this the signed-in app
          had NO logo anywhere on a phone: the animated 96px mark lives on the
          LOGIN page only, which meant the brand appeared once, at the moment
          you leave it behind.

          STATIC, per BrandMark's frequency tier. This bar is on screen on
          every page all day; an assemble animation here would replay on every
          navigation. 22px because the bar is 48px tall and the mark has to sit
          on the cap-height of the wordmark beside it, not tower over it.
        */}
        <BrandMark size={22} className="flex-none" />
        <span className="font-sans text-[13px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
          HSE HUB
        </span>
      </div>

      {/*
        Backdrop. Blurred as well as dimmed, which is the half of "frosted" that
        gets forgotten: the sheet can only read as glass if what is BEHIND it is
        visibly out of focus. bg-black/40 rather than /60 because the blur is now
        doing most of the separating, and a heavy scrim over a blur just reads as
        mud.

        It fades rather than appearing: an opacity step is the one transition
        that survives being interrupted mid-way, which matters here because the
        sheet can be dismissed before it has finished opening.
      */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-[3px] transition-opacity duration-200 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setOpen(false)}
        aria-hidden
      />

      {/*
        A FLOATING BOTTOM SHEET, not a full-height side slab.

        WHY IT MOVED. The old drawer came in from the left edge, full height,
        square-cornered and fully opaque -- the desktop sidebar transplanted onto
        a phone. It was measured at x=0 y=0 w=260 h=844, radius 0, backdrop
        none, beside a tab bar that is a 358x58 frosted pill inset 16px with a
        24px blur. Two navigation surfaces in one app speaking two visual
        languages, and the one that opens FROM the pill was the one that looked
        least like it.

        It also fought the hand. "More" sits at the bottom-right of the pill,
        where the thumb already is; a panel that then anchors to the top-left is
        the furthest travel available on a 390x844 screen. A sheet rises from
        the same edge the tap happened on.

        THE GEOMETRY IS THE TAB BAR'S, deliberately. Same 16px side inset, same
        --glass-edge hairline, same surface-translucent (0.80 alpha over
        blur(24px) saturate(180%), with the @supports guard and the
        prefers-reduced-transparency fallback that class carries). Matching by
        REUSE rather than by eye means a future change to the glass reaches both,
        and the alpha stays the measured 4.5-contrast floor rather than a second,
        unmeasured value.

        rounded-t-[28px], not rounded-full. A pill radius on a sheet this tall
        would bow the top edge into an arch and eat the first row's corners; 28px
        is the tab bar's own 29px (half of 58) applied to the two corners that
        are actually visible, so the family resemblance holds without the shape
        becoming silly.

        max-h-[72svh] and svh, not vh. On mobile Safari, 100vh is the LARGEST
        viewport -- it excludes the browser chrome that is on screen when you
        open a sheet -- so a vh-sized panel is taller than the space it has and
        its last row hides behind the URL bar. svh is the small viewport, the
        honest one. 72% leaves the page visibly alive behind the sheet, which is
        what tells you this is a layer and not a new page.

        IT SITS ABOVE THE TAB BAR, NOT OVER IT. bottom-[calc(84px+env(...))]
        clears the pill (58px tall, 12px off the bottom, plus breathing room) so
        the bar stays visible and "More" stays lit while its own panel is open.
        The first attempt covered the bar at z-50 and padded the sheet's content
        by 88px to compensate -- which cleared nothing, because the bar was
        underneath, and left a blank slab at the bottom of the sheet. Clearing it
        in the POSITION is what the layering actually needed.

        Fully rounded now, not rounded-t. A panel that floats clear of every edge
        has four visible corners; rounding only the top was correct while it was
        anchored to the bottom edge and wrong the moment it lifted off it.

        max-h-[68svh] with the content sized naturally: the sheet is as tall as
        its nine nav rows and no taller, and only starts scrolling when a longer
        list would exceed the cap.

        translate-y-full when closed: it slides from the bottom edge it belongs
        to. The old -translate-x-full slid it off the left, which is now the one
        direction nothing in this navigation lives.
      */}
      <div
        data-testid="mobile-sheet"
        className={`surface-translucent card-elev-raised fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-50 mx-2 flex max-h-[68svh] flex-col overflow-hidden rounded-[28px] border border-[var(--glass-edge)] transition-transform duration-300 ease-out lg:hidden ${
          open ? "translate-y-0" : "pointer-events-none translate-y-full"
        }`}
        /*
          aria-hidden + inert when closed, and pointer-events-none above.

          The sheet floats 84px off the bottom edge so the tab bar stays visible
          beneath it. That means "off-screen" is no longer off the VIEWPORT: at
          translate-y-full its top edge lands at y=760, directly over the pill.
          It is invisible but still hit-testable, so it silently swallowed every
          tap aimed at "More" -- the button that opens it. The failure mode is a
          control that does nothing at all, with no error to notice.

          inert also takes it out of the tab order and the accessibility tree,
          so a keyboard or screen-reader user cannot land inside a panel that is
          not there. Both are needed: pointer-events-none fixes the thumb, inert
          fixes everything else.
        */
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        aria-hidden={!open}
        inert={!open}
      >
        {/*
          The grab handle. It is not decoration: it is the affordance that says
          "this panel came from the bottom edge and goes back there", and every
          one of the reference shots has one. aria-hidden because it says
          nothing a screen reader needs -- the close button below is the real,
          named control.
        */}
        <div aria-hidden className="flex justify-center pt-2.5 pb-1">
          <div className="h-1 w-9 rounded-full bg-[var(--text-faint)] opacity-40" />
        </div>
        {/*
          44x44, up from 28x28. The old close button was a 7x7 Tailwind box: 28px,
          well under the 44px minimum this codebase already holds its tab targets
          to, and placed in the corner a thumb reaches last. Same glyph, honest
          target, and it keeps its accessible name.
        */}
        <button
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
          className="absolute top-1.5 right-2 flex h-11 w-11 items-center justify-center rounded-full text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        {/*
          h-full became min-h-0 + flex-1. Inside a flex column with a max height,
          h-full resolves against the PARENT's full height rather than the space
          left after the handle, so the list overflowed past the sheet's rounded
          bottom instead of scrolling within it.

          The bottom padding clears the home indicator AND the tab bar the sheet
          is layered over, so the last nav row is never sitting under either.
        */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      </div>

      {/*
        The bottom tab bar. Rendered here rather than in the layout because the
        drawer's open state lives in this component and the "More" tab both
        opens it and reflects it — lifting that state into the server layout is
        not possible, and duplicating it would let the bar say "closed" while
        the drawer is open.
      */}
      <MobileTabBar roleKey={roleKey} moreOpen={open} onOpenMore={() => setOpen(true)} />
    </>
  );
}
