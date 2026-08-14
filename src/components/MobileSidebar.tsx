"use client";

/**
 * MobileSidebar — client shell that owns the open/close state for the mobile
 * slide-in drawer. Renders a hamburger button in the top bar and wraps the
 * sidebar content with a backdrop + slide-in panel. Used exclusively on small
 * screens (hidden on lg+). The actual nav content is passed as children so the
 * server-side Sidebar async component can keep fetching user/role data.
 */

import { useState, useEffect } from "react";

interface MobileSidebarProps {
  children: React.ReactNode;
}

export function MobileSidebarToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-label="Open navigation"
      className="flex h-8 w-8 items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] lg:hidden"
    >
      {/* Hamburger icon */}
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden>
        <rect y="0" width="18" height="2" rx="1" fill="currentColor" />
        <rect y="6" width="18" height="2" rx="1" fill="currentColor" />
        <rect y="12" width="18" height="2" rx="1" fill="currentColor" />
      </svg>
    </button>
  );
}

export function MobileSidebarDrawer({ children }: MobileSidebarProps) {
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
      {/* Mobile top bar — hamburger + brand mark */}
      <div className="fixed top-0 left-0 right-0 z-30 flex h-12 items-center gap-3 border-b border-[var(--border)] bg-[var(--sidebar)] px-4 lg:hidden">
        <MobileSidebarToggle onOpen={() => setOpen(true)} />
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
    </>
  );
}
