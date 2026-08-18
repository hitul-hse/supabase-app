"use client";

import { useState } from "react";
import type { LivePerson } from "@/lib/queries/people-live";
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
  archivedCount,
  unlinkedCount,
  mailboxCount,
}: {
  people: LivePerson[];
  archivedCount: number;
  unlinkedCount: number;
  mailboxCount: number;
}) {
  const [view, setView] = useState<"directory" | "orgchart">("directory");

  return (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 sm:px-6">
        <div className="flex border border-[var(--border-strong)]">
          <button
            onClick={() => setView("directory")}
            className={`px-3 py-1 text-[11px] font-medium ${
              view === "directory"
                ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
            }`}
          >
            Directory
          </button>
          <button
            onClick={() => setView("orgchart")}
            className={`border-l border-[var(--border-strong)] px-3 py-1 text-[11px] font-medium ${
              view === "orgchart"
                ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
            }`}
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
        />
      ) : (
        <OrgChartView people={people} />
      )}
    </>
  );
}
