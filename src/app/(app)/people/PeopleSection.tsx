"use client";

import { useState } from "react";
import type { PersonProfile, OrgChartNode } from "@/lib/queries/types";
import { PeopleDirectory } from "./PeopleDirectory";
import { OrgChartView } from "./OrgChartView";

export function PeopleSection({
  people,
  orgChartNodes,
}: {
  people: PersonProfile[];
  orgChartNodes: OrgChartNode[];
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
      </div>

      {view === "directory" ? <PeopleDirectory people={people} /> : <OrgChartView nodes={orgChartNodes} />}
    </>
  );
}
