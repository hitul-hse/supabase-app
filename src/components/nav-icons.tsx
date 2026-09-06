/**
 * nav-icons — the sidebar's icon set, authored inline.
 *
 * Hand-drawn rather than pulled from a library because this project has no
 * icon dependency (see package.json: framer-motion, next, react, supabase and
 * nothing else) and adding one to draw nine glyphs is a poor trade. Unicode
 * glyphs and emoji were the other option and are not an icon system: they
 * inherit the text font, break stroke consistency, and render differently on
 * every platform.
 *
 * House rules, so the family stays coherent as icons are added:
 *   - 16x16 viewBox, stroked (never filled), `currentColor`
 *   - stroke-width 1.5, round caps and joins
 *   - drawn on a 1px grid at .5 offsets so edges land on device pixels
 *     instead of blurring across two
 *
 * They are decorative: every icon is `aria-hidden` and each nav item carries
 * its own text label (visually hidden in rail mode). An icon is never the
 * accessible name.
 */

type IconProps = { className?: string };

function Svg({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Overview — a house. */
export function IconHome({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.5 6.5 8 2.25l5.5 4.25V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V6.5Z" />
      <path d="M6.25 13.5v-4h3.5v4" />
    </Svg>
  );
}

/** Team Lead View — a person above a small cohort. */
export function IconTeamLead({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="4.75" r="2.25" />
      <path d="M3.5 13.25a4.5 4.5 0 0 1 9 0" />
      <path d="M1.75 11.5a3 3 0 0 1 1.5-1.6M14.25 11.5a3 3 0 0 0-1.5-1.6" />
    </Svg>
  );
}

/** People — two figures. */
export function IconPeople({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="6.25" cy="5.75" r="2.25" />
      <path d="M2 13.25a4.25 4.25 0 0 1 8.5 0" />
      <path d="M10.75 3.75a2.25 2.25 0 0 1 0 4M11.5 9.4a4.25 4.25 0 0 1 2.5 3.85" />
    </Svg>
  );
}

/**
 * My Work — a briefcase, i.e. one person's book of work.
 *
 * Deliberately NOT a person glyph: /people already owns the figure, and two
 * near-identical outlines in the same nav group are indistinguishable at 16px
 * in the collapsed rail, where the icon is the only label there is.
 */
export function IconMyWork({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="1.75" y="5.25" width="12.5" height="8.5" rx="1.5" />
      <path d="M5.75 5.25V3.75a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1v1.5" />
      <path d="M1.75 8.75h12.5" />
    </Svg>
  );
}

/** Projects — stacked layers. */
export function IconProjects({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 2.25 14 5.5 8 8.75 2 5.5l6-3.25Z" />
      <path d="m2 8.5 6 3.25L14 8.5" />
      <path d="m2 11.25 6 3.25 6-3.25" />
    </Svg>
  );
}

/** Timesheets — a grid, the weekly entry table. */
export function IconTimesheets({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.25" />
      <path d="M2.25 6.25h11.5M6.5 6.25v7M10 6.25v7" />
    </Svg>
  );
}

/** TrackingTime Dashboard — a clock, the imported-hours module. */
export function IconTrackingTime({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.75V8l2.25 1.5" />
    </Svg>
  );
}

/** Leave & Time Off — a calendar. */
export function IconLeave({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.25" y="3.5" width="11.5" height="10" rx="1.25" />
      <path d="M2.25 6.5h11.5M5.5 2.25v2.5M10.5 2.25v2.5" />
    </Svg>
  );
}

/** Users & Roles — a person with a check, i.e. granted access. */
export function IconUsersRoles({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="6.5" cy="5.5" r="2.5" />
      <path d="M2 13.25a4.5 4.5 0 0 1 7.25-3.55" />
      <path d="m9.75 11.75 1.5 1.5 3-3.5" />
    </Svg>
  );
}

/** Role Permissions — a shield, the permission matrix. */
export function IconPermissions({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 2 13 4v4c0 3-2.1 5-5 6-2.9-1-5-3-5-6V4l5-2Z" />
      <path d="m6 8 1.5 1.5L10.25 6.5" />
    </Svg>
  );
}

/** Fallback so a new nav entry never renders an empty box. */
export function IconDot({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="2.75" />
    </Svg>
  );
}

/** Collapse the sidebar to the rail. */
export function IconPanelCollapse({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.25" y="3" width="11.5" height="10" rx="1.25" />
      <path d="M9.75 3v10" />
      <path d="M7 6.5 5.25 8 7 9.5" />
    </Svg>
  );
}

/** Expand the sidebar back to full width. */
export function IconPanelExpand({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.25" y="3" width="11.5" height="10" rx="1.25" />
      <path d="M6.25 3v10" />
      <path d="M9 6.5 10.75 8 9 9.5" />
    </Svg>
  );
}

/**
 * Status and action glyphs.
 *
 * These replace the Unicode characters the app was using for the same jobs — ✓
 * ✕ ⚠ → ↺ • — which are not an icon system: they inherit the text font rather
 * than the stroke family, so they sit at a different weight beside every real
 * icon, and the arrows in particular render at wildly different widths per
 * platform. Drawn to the same 16x16 / 1.5-stroke rules as the nav set.
 */

/** Success / satisfied requirement. */
export function IconCheck({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3.25 8.5 6.25 11.5 12.75 5" />
    </Svg>
  );
}

/** Failure, or dismiss/cancel an item. */
export function IconCross({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  );
}

/** Caution — a state the user should read before acting. */
export function IconWarning({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 2.25 14.25 13.5H1.75L8 2.25Z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.6v.15" />
    </Svg>
  );
}

/** Forward navigation, in a link or breadcrumb. */
export function IconArrowRight({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.75 8h10.5" />
      <path d="M9.5 4.25 13.25 8 9.5 11.75" />
    </Svg>
  );
}

/** Replay / restart — used by the onboarding tour. */
export function IconReplay({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M13.25 8a5.25 5.25 0 1 1-1.6-3.77" />
      <path d="M13.4 2.5v2.9h-2.9" />
    </Svg>
  );
}

/** Search — the top bar's find control. */
export function IconSearch({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="7.25" cy="7.25" r="4.5" />
      <path d="m10.75 10.75 2.5 2.5" />
    </Svg>
  );
}

/** Refresh — re-read the current view's data. */
export function IconRefresh({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M13.25 8a5.25 5.25 0 1 1-1.6-3.77" />
      <path d="M13.4 2.5v2.9h-2.9" />
      <path d="M2.75 8a5.25 5.25 0 0 0 1.6 3.77" />
    </Svg>
  );
}

/** Open in full — the reference's diagonal "expand this panel" affordance. */
export function IconExpand({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9.5 2.75h3.75V6.5" />
      <path d="M13.25 2.75 8.5 7.5" />
      <path d="M6.5 13.25H2.75V9.5" />
      <path d="M2.75 13.25 7.5 8.5" />
    </Svg>
  );
}

function IconAlerts({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 2.25 14.5 13.5h-13L8 2.25Z" />
      <path d="M8 6.5v3.25" />
      <path d="M8 11.5v.5" />
    </Svg>
  );
}

/**
 * Data hygiene: a lens over records that disagree.
 *
 * Deliberately NOT a warning triangle -- IconAlerts owns that shape, and
 * conflating "somebody must act on this commercial exception" with "these two
 * rows should be one" would make both icons mean less.
 *
 * Uses the shared Svg wrapper like every other icon: stroke width, linecap and
 * aria-hidden are set there once, so no single icon can drift from the set.
 */
function IconDataHygiene({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2 L14 14" />
      {/* two rules that do not line up -- the discrepancy the page is about */}
      <path d="M5.4 6.2 h3.2" />
      <path d="M5.4 8.4 h1.8" />
    </Svg>
  );
}

/**
 * Operations Analytics: a person beside two bars of different height --
 * presence vs logged hours, which is the page's whole subject.
 */
function IconOperationsAnalytics({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="6" cy="5" r="2.25" />
      <path d="M2.75 13.25 v-1.5 a3.25 3.25 0 0 1 6.5 0 v1.5" />
      <path d="M12 13.25 V7.5" />
      <path d="M15 13.25 V4.75" />
    </Svg>
  );
}

/**
 * The 7px filled caret the sort headers draw, pointing DOWN. The one exception
 * to the stroked rule above: at 7px a stroked triangle has no interior, and
 * this is the disclosure dialect (collapsible tables, select triggers) shared
 * with SortHeader so a reader learns one caret. Rotate with a class.
 */
export function IconCaret({ className }: IconProps) {
  return (
    <svg
      width="7"
      height="7"
      viewBox="0 0 8 8"
      fill="currentColor"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M0 1.5h8L4 7z" />
    </svg>
  );
}

/** Up and down — the keyboard hint for a list that arrow keys move through. */
export function IconArrowsVertical({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 13.25V2.75" />
      <path d="M2.75 5 5 2.75 7.25 5" />
      <path d="M11 2.75v10.5" />
      <path d="M8.75 11 11 13.25 13.25 11" />
    </Svg>
  );
}

/** A person — the account menu's Profile entry. */
export function IconUser({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="5.25" r="2.75" />
      <path d="M2.75 13.5a5.25 5.25 0 0 1 10.5 0" />
    </Svg>
  );
}

/** Sign out — the account menu's exit. */
export function IconLogout({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6.25 13.5H3.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.75" />
      <path d="M10.25 10.75 13 8l-2.75-2.75" />
      <path d="M13 8H6.25" />
    </Svg>
  );
}

/** Registry keyed by nav href, so SidebarNav stays declarative. */
export const NAV_ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  "/": IconHome,
  "/dashboard/management": IconTeamLead,
  "/team-lead": IconTeamLead,
  "/my-work": IconMyWork,
  "/people": IconPeople,
  "/projects": IconProjects,
  "/timesheets": IconTimesheets,
  "/time/dashboard": IconTrackingTime,
  "/operations-analytics": IconOperationsAnalytics,
  "/leave": IconLeave,
  "/admin/users": IconUsersRoles,
  "/admin/roles": IconPermissions,
  "/admin/alerts": IconAlerts,
  "/data-hygiene": IconDataHygiene,
};
