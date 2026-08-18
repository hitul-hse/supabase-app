"use client";

import { useState } from "react";
import type { LivePerson } from "@/lib/queries/people-live";
import type { OrgChartData } from "@/lib/queries/org-chart-live";
import { PeopleDirectory } from "./PeopleDirectory";
import { OrgChartView } from "./OrgChartView";

/**
 * Directory / org-chart switcher.
 *
 * Both views render the SAME live roster. They used to read different sources —
 * the directory from `time.member` and the org chart from the seeded
 * `public.org_chart_nodes` — which meant eight mockup names were serialised into
 * the page payload on every visit, whichever tab was showing.
 */
export function PeopleSection({
  people,
  chart,
  canEditPeople,
  archivedCount,
  unlinkedCount,
  mailboxCount,
  initialQuery = "",
}: {
  people: LivePerson[];
  /** The reporting tree, recorded in the Hub because TrackingTime has none. */
  chart: OrgChartData;
  /** Whether this viewer holds people:write and may record structure. */
  canEditPeople: boolean;
  archivedCount: number;
  unlinkedCount: number;
  mailboxCount: number;
  /** Seeded from ?q= so the Overview can deep-link straight to one colleague. */
  initialQuery?: string;
}) {
  const [view, setView] = useState<"directory" | "orgchart">("directory");

  const tabClass = (active: boolean, extra = "") =>
    `${extra} px-3 py-1 text-[11px] font-medium transition-colors duration-150 ` +
    (active
      ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]");

  return (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 sm:px-6">
        {/*
          Real tab semantics. These were two plain buttons whose only signal was
          a background colour, so a screen-reader user was told "Directory,
          button" with no indication that one of the two was already showing.
        */}
        <div role="tablist" aria-label="People view" className="flex border border-[var(--border-strong)]">
          <button
            role="tab"
            aria-selected={view === "directory"}
            onClick={() => setView("directory")}
            className={tabClass(view === "directory")}
          >
            Directory
          </button>
          <button
            role="tab"
            aria-selected={view === "orgchart"}
            onClick={() => setView("orgchart")}
            className={tabClass(view === "orgchart", "border-l border-[var(--border-strong)]")}
          >
            Org chart
          </button>
        </div>

        <span className="ml-auto font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
          SOURCE: TRACKINGTIME
        </span>
      </div>

      {view === "directory" ? (
        <PeopleDirectory
          people={people}
          archivedCount={archivedCount}
          unlinkedCount={unlinkedCount}
          mailboxCount={mailboxCount}
          initialQuery={initialQuery}
        />
      ) : (
        <OrgChartView chart={chart} canEdit={canEditPeople} />
      )}
    </>
  );
}
