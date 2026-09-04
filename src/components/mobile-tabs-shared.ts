/**
 * Which routes get a bottom tab on a phone, and their short labels.
 *
 * NO "use client" DIRECTIVE, deliberately. A server component that imports a
 * value from a "use client" module receives a client-reference PROXY, not the
 * value — this codebase has already shipped that bug once (SIDEBAR_COOKIE, see
 * sidebar-collapse-shared.ts): it type-checks, builds, and silently does
 * nothing at runtime. Anything both sides need lives in a plain module.
 *
 * The href list is a SELECTION from SidebarNav's NAV_GROUPS, not a redefinition
 * of it: `mobileTabsFor` looks each href up in the real nav data and applies the
 * real role filter, so a tab can never appear for a role the sidebar hides it
 * from.
 */

/** Ordered. Four is the ceiling: with "More" that is five targets across
 *  390px = 78px each, comfortably over the 44px minimum. A fifth tab drops
 *  every target to 65px and starts truncating labels to two characters. */
export const MOBILE_TAB_HREFS = ["/", "/my-work", "/projects", "/people"] as const;

/** Sidebar labels are written for a 220px panel ("TrackingTime Dashboard",
 *  "Leave & Time Off"). At 78px they must be one short word. */
const SHORT_LABELS: Record<string, string> = {
  "/": "Overview",
  "/my-work": "My Work",
  "/projects": "Projects",
  "/people": "People",
  "/timesheets": "Hours",
  "/team-lead": "Team",
  "/time/dashboard": "Tracking",
  "/leave": "Leave",
  "/dashboard/management": "Manage",
};

export interface MobileTab {
  href: string;
  short: string;
}

/**
 * Resolve the tab list for a role.
 *
 * `allowedHrefs` is the set the sidebar would render for this role — passed in
 * rather than imported, because NAV_GROUPS lives in a "use client" module and
 * the caller already has it.
 *
 * MobileTabBar now always passes it. It used not to, on the reasoning that all
 * four defaults are ungated in NAV_GROUPS so there was nothing to filter — true
 * of `roles` arrays, and false as soon as a role is restricted to a fixed route
 * list (see nav-access.ts), which is precisely a case where an ungated item must
 * still be withheld. The parameter stays optional so the fallback is stated
 * rather than implied, but omitting it is now a caller bug, not a shortcut.
 */
export function mobileTabsFor(_roleKey: string | null, allowedHrefs?: Set<string>): MobileTab[] {
  return MOBILE_TAB_HREFS.filter((h) => !allowedHrefs || allowedHrefs.has(h)).map((href) => ({
    href,
    short: SHORT_LABELS[href] ?? href,
  }));
}
