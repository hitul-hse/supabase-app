"use client";

/**
 * SidebarToggle — the control that hides and shows the desktop sidebar.
 *
 * Two instances render, and only ever one is visible:
 *   - `variant="inside"`  sits in the sidebar's own header (visible when open)
 *   - `variant="rail"`    sits pinned to the left edge of the page (visible
 *                         when collapsed, and the ONLY way back)
 *
 * That second one is the whole reason this is two components rather than one.
 * If the only affordance lived inside the sidebar, collapsing it would also
 * remove the button that reopens it -- the classic one-way door, escapable
 * only by clearing a cookie or knowing the keyboard shortcut.
 *
 * Hidden on mobile (`lg:` only): below that breakpoint navigation is a
 * slide-in drawer with its own hamburger, and a collapse control there would
 * be a second, conflicting mental model for the same thing.
 */

import { useSidebarCollapse } from "./SidebarCollapseContext";

function ChevronsLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M6.5 3.5L3 7l3.5 3.5M11 3.5L7.5 7l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronsRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M7.5 3.5L11 7l-3.5 3.5M3 3.5L6.5 7 3 10.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SidebarToggle({ variant }: { variant: "inside" | "rail" }) {
  const { collapsed, toggle, forcedOpen } = useSidebarCollapse();

  // The tour holds the sidebar open; showing an enabled control that silently
  // does nothing is worse than showing none, so hide it for the duration.
  if (forcedOpen) return null;

  // Each variant is only meaningful in one state.
  if (variant === "inside" && collapsed) return null;
  if (variant === "rail" && !collapsed) return null;

  const label = collapsed ? "Show sidebar" : "Hide sidebar";

  // aria-keyshortcuts (not just the tooltip) so assistive tech announces the
  // binding rather than it being discoverable only by reading the title text.
  const shared = {
    onClick: toggle,
    "aria-label": label,
    "aria-expanded": !collapsed,
    "aria-controls": "app-sidebar",
    "aria-keyshortcuts": "Control+B",
    title: `${label}  (Ctrl+B)`,
    "data-testid": `sidebar-toggle-${variant}`,
  };

  if (variant === "rail") {
    return (
      <button
        {...shared}
        type="button"
        className="fixed left-0 top-3 z-40 hidden h-8 w-8 items-center justify-center rounded-r-[var(--radius-sm)] border border-l-0 border-[var(--border)] bg-[var(--sidebar)] text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] lg:flex"
      >
        <ChevronsRight />
      </button>
    );
  }

  return (
    <button
      {...shared}
      type="button"
      className="hidden h-6 w-6 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] lg:flex"
    >
      <ChevronsLeft />
    </button>
  );
}
