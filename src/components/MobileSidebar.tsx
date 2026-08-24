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
      <div className="fixed top-0 left-0 right-0 z-30 flex h-12 items-center gap-3 border-b border-[var(--border)] bg-[var(--sidebar)] px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <span className="font-sans text-[13px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
          HSE HUB
        </span>
      </div>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Slide-in drawer */}
      <div
        className={`fixed top-0 left-0 z-50 h-full w-[260px] transform bg-[var(--sidebar)] shadow-2xl transition-transform duration-300 ease-in-out lg:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        {/* Close button inside drawer */}
        <button
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
          className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-primary)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        {/* Sidebar content (server-rendered, passed as children) */}
        <div className="h-full overflow-y-auto" onClick={() => setOpen(false)}>
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
