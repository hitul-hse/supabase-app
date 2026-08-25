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
        AN EDGE-ANCHORED BOTTOM SHEET. Not a floating card, and not a
        full-height side slab.

        WHY IT IS NO LONGER DETACHED. The previous version was `mx-2`, rounded
        on all four corners at 28px, hovering 84px off the bottom edge: a
        ~374x520 rounded rectangle sitting in the middle of a 390x844 screen
        with page visible above, below and either side of it. That is a
        free-floating widget, which is exactly the shape the floating PILL was
        reworked away from -- and at this size it is far more of one, because a
        58px pill reads as a control while a 520px card reads as a second
        window.

        The pill can float because it is small, permanent, and has nothing to
        anchor to. A sheet is the opposite: it is large, temporary, and rises
        from the edge you tapped. Every phone OS anchors them (iOS action
        sheets, Android Material bottom sheets) for a reason -- an edge contact
        is what tells the eye "this came from there and goes back there",
        which is the whole grammar of a sheet. Floating it clear of the edge
        removes the one cue that makes the gesture legible.

        So: `inset-x-0 bottom-0`, no side margin, only the TOP two corners
        rounded. It meets three edges of the screen and has exactly one visible
        boundary, the top -- where the grab handle is.

        IT COVERS THE TAB BAR NOW, deliberately, and that is the standard
        behaviour rather than a compromise. The bar is z-30, the sheet z-50.
        The previous design floated the sheet ABOVE the bar so "More" stayed
        lit, which is what forced the 84px offset and the detachment in the
        first place -- a visual cost paid for an indicator nobody needs while
        the panel it refers to is already open on screen. The backdrop and the
        close button are the way out, and both are tested below.

        border-t only. A hairline on the left, right and bottom edges of a
        panel that is flush to those edges renders as a stray line against the
        screen border, and on the bottom edge it sits under the home
        indicator.

        THE GLASS IS STILL THE TAB BAR'S, by reuse: surface-translucent carries
        the gradient, the 28px blur at 180% saturation, the @supports guard and
        the prefers-reduced-transparency fallback. Matching by REUSE rather
        than by eye means a future change to the glass reaches both surfaces,
        and the alpha stays the measured 4.5-contrast floor rather than a
        second, unmeasured value.

        max-h-[72svh] and svh, not vh. On mobile Safari 100vh is the LARGEST
        viewport -- it excludes the browser chrome that is on screen when you
        open a sheet -- so a vh-sized panel is taller than the space it has and
        its last row hides behind the URL bar. svh is the small viewport, the
        honest one. 72% leaves the page visibly alive above the sheet, which is
        what tells you this is a layer and not a new page.

        translate-y-full when closed now genuinely parks it BELOW the viewport,
        because the sheet is flush to the bottom edge. While it floated 84px up,
        the same transform left its top edge at y=760 -- invisible but still
        hit-testable, directly over the pill, silently swallowing every tap
        aimed at the button that opens it.
      */}
      <div
        data-testid="mobile-sheet"
        className={`surface-translucent card-elev-raised fixed inset-x-0 bottom-0 z-50 flex max-h-[72svh] flex-col overflow-hidden rounded-t-[28px] border-t border-[var(--glass-edge)] transition-transform duration-300 ease-out lg:hidden ${
          open ? "translate-y-0" : "pointer-events-none translate-y-full"
        }`}
        /*
          aria-hidden + inert when closed, and pointer-events-none above.

          All three are kept even though the sheet is now flush to the bottom
          edge and translate-y-full genuinely clears the viewport. Being
          off-screen is not the same as being out of the accessibility tree: a
          keyboard or screen-reader user could still tab into a panel that is
          not visible, land on nine nav links, and have no idea where focus
          went. inert removes it from the tab order AND the a11y tree;
          pointer-events-none covers the thumb if the transform is ever
          interrupted mid-flight.
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

          pb-[env(safe-area-inset-bottom)] is REQUIRED now and was not before.
          While the sheet floated 84px up, the inset was already cleared by the
          offset; flush to the bottom edge, the last nav row would sit under the
          home indicator on every notched iPhone. Plus 8px so the final row is
          not touching the screen edge.
        */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(8px+env(safe-area-inset-bottom))]"
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
