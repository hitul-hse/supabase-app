"use client";

/**
 * Sub-tabs across the two records surfaces: the Hub's timesheet grid, and TrackingTime.
 *
 * WHY THIS EXISTS. The route to the personal time tracker was a "My time tracker →"
 * button in the TrackingTime dashboard's header. The user reported it appearing only
 * sometimes, out of nowhere, and they were right for a reason no amount of reading the
 * component would reveal: that button is an UNCOMMITTED local edit. It exists in the
 * working tree and not in the deployed build, so whether it was on screen depended on
 * which deployment was serving. Verified against production -- the header renders with no
 * actions element at all.
 *
 * A tab is the right shape regardless. The button was one page's header decoration, which
 * is a poor place for navigation: invisible from anywhere else, and gone the moment that
 * header changes. These tabs sit in the same position on every surface they belong to, so
 * the set of places you can go does not depend on where you happen to be.
 *
 * WHY A CLIENT COMPONENT, when TimeViewTabs next to it is a Server Component built from
 * links. This needs usePathname to know which tab is current, and it renders on three
 * routes with different data-fetching shapes. Nothing else here is stateful: they are
 * plain links, so navigation still works without JavaScript, and the active state is the
 * only thing that needs the pathname.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export type RecordsTabKey = "timesheets" | "trackingtime" | "dashboard";

/**
 * @param canReadAll Whether the viewer holds timesheets:read_all. The dashboard tab is
 *   only shown to them, because /time/dashboard redirects everybody else straight back
 *   to /time -- a tab that bounces you elsewhere is worse than no tab.
 */
export function RecordsTabs({ canReadAll }: { canReadAll: boolean }) {
  const pathname = usePathname();

  const tabs: { key: RecordsTabKey; href: string; label: string; hint: string }[] = [
    {
      key: "timesheets",
      href: "/timesheets",
      label: "Timesheets",
      hint: "The Hub's editable weekly grid, in hours",
    },
    {
      key: "trackingtime",
      href: "/time",
      label: "TrackingTime",
      hint: "Track your own time, in seconds, as TrackingTime records it",
    },
  ];

  if (canReadAll) {
    tabs.push({
      key: "dashboard",
      href: "/time/dashboard",
      label: "TrackingTime Dashboard",
      hint: "Filtered reporting across the whole organisation",
    });
  }

  // Longest match wins, so /time/dashboard does not also light up the /time tab. Sorting
  // by href length and taking the first match is simpler than special-casing the nesting,
  // and stays correct if another nested route is added later.
  const activeHref = [...tabs]
    .sort((a, b) => b.href.length - a.href.length)
    .find((t) => pathname === t.href || pathname?.startsWith(`${t.href}/`))?.href;

  return (
    <div
      // A tablist, not a row of links styled like one: this is a set of alternative views
      // of the same records, and a screen reader should hear it as such.
      role="tablist"
      aria-label="Records view"
      className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 sm:px-6"
    >
      {tabs.map((tab) => {
        const active = tab.href === activeHref;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            title={tab.hint}
            /*
             * A filled pill for the current tab rather than an underline: the reference
             * navigation (FinPoint's Dashboard/Investment/Card row) carries selection as
             * a pill, and the rest of this app's segment controls now speak the same
             * shape, so an underline here would be the odd one out.
             */
            className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
              active
                ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
