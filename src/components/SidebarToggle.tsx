"use client";

/**
 * SidebarToggle — collapses the desktop sidebar to the icon rail and back.
 *
 * ONE control, always on screen, in both states.
 *
 * The previous build needed two: a button inside the panel, plus a second one
 * pinned to the page edge, because collapsing to width 0 also hid the first.
 * That is the "one-way door" the gate guards against -- hide the sidebar, lose
 * the only way to get it back.
 *
 * The rail dissolves that problem rather than working around it. The panel
 * never disappears, so the control inside it never disappears either, and the
 * floating edge button is gone. Fewer moving parts, and the affordance stays
 * exactly where the user last saw it instead of teleporting to the viewport
 * edge.
 *
 * Desktop only (`lg:`). Below that, navigation is a drawer with its own
 * hamburger; a collapse control there would be a second, conflicting model.
 */

import { useSidebarCollapse } from "./SidebarCollapseContext";
import { IconPanelCollapse, IconPanelExpand } from "./nav-icons";

export function SidebarToggle() {
  const { collapsed, toggle, forcedOpen } = useSidebarCollapse();

  // The tour pins the sidebar open; an enabled control that silently does
  // nothing is worse than no control, so hide it for the duration.
  if (forcedOpen) return null;

  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-expanded={!collapsed}
      aria-controls="app-sidebar"
      // Announced by assistive tech, not just discoverable by hovering.
      aria-keyshortcuts="Control+B"
      title={`${label}  (Ctrl+B)`}
      data-testid="sidebar-toggle"
      /*
        40 × 32: the same box as a rail row target, so in the rail it stacks
        under the brand mark on the icon column and its tooltip lands where the
        rows' do. Above Apple's 28 × 28 desktop default for an icon-only
        control (APPLE_REF §3.2) in both dimensions that matter.
      */
      className="group/toggle relative hidden h-8 w-10 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-faint)] transition-[color,background-color,transform] duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] lg:flex"
    >
      {collapsed ? <IconPanelExpand /> : <IconPanelCollapse />}

      {/*
        Only in the rail: expanded, the panel is wide enough that the icon plus
        its title attribute are sufficient, and a tooltip on every hover there
        would be noise. M2 raised material like the nav rows' tooltips, flush
        to the rail's outer edge (12 px = the pane's inset).
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 py-1.5 t-callout text-[var(--text-primary)] opacity-0 card-elev-raised transition-opacity duration-100 group-hover/toggle:opacity-100 group-hover/toggle:duration-150 group-focus-visible/toggle:opacity-100 group-focus-visible/toggle:duration-150 pointer-fine:group-data-[collapsed=true]/sidebar:block"
      >
        {label}
        <span className="ml-1.5 t-label text-[var(--text-faint)]">Ctrl+B</span>
      </span>
    </button>
  );
}
