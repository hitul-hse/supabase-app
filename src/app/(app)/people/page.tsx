import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requirePermission, userHasPermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getLivePeople } from "@/lib/queries/people-live";
import { getOrgChart } from "@/lib/queries/org-chart-live";
import { PeopleSection } from "./PeopleSection";
import PageTransition from "@/components/animations/PageTransition";

/**
 * The people directory.
 *
 * Reads `time.member` (49 real colleagues imported from TrackingTime), not the
 * seeded `public.people` mockup it used to render — eight invented rows for a
 * company of 49. Since 2026-09-02 it ALSO lists current Hub people who have no
 * TrackingTime member at all (three Factorial employees), flagged as Hub-only
 * with every time-derived figure honestly n/a. See queries/people-live.ts.
 */
export default async function PeoplePage({
  searchParams,
}: {
  // Async in this Next version — awaiting is required, not optional.
  // ?archived=1 mirrors /projects. It is a URL param and not client state
  // because getLivePeople decides which rows are fetched at all: 30 of the 49
  // members are archived, and a client toggle could only ever hide rows that
  // were already on the wire.
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  // Previously a bare requireProfile with no permission check at all, so
  // people:read_own — the key the directory exists to gate — decided nothing.
  // All four roles hold it, so this removes access from nobody; it makes the
  // toggle in /admin/roles real, which is the point.
  await requirePermission("/people", PERMISSIONS.PEOPLE_READ_OWN);
  const supabase = await createClient();

  // Both tabs render from this ONE roster. They used to read different sources,
  // so the org chart's eight mockup names shipped in the RSC payload on every
  // visit — including while the real directory was on screen.
  // The org chart reads the same table, plus the reporting lines recorded in the
  // Hub -- TrackingTime carries none, so there is nothing to import. Fetched in
  // parallel because neither depends on the other.
  // Read BEFORE the fetch: it decides what getLivePeople returns.
  const { q, archived } = await searchParams;
  const includeArchived = archived === "1";

  const [directory, chart, canEditPeople] = await Promise.all([
    getLivePeople(supabase, { includeArchived }),
    getOrgChart(supabase),
    // Whether to show the editor at all. The server actions re-check this on every
    // write, so hiding the buttons is presentation, not the security boundary.
    userHasPermission(PERMISSIONS.PEOPLE_WRITE),
  ]);

  // The Overview's utilisation rows deep-link here as /people?q=<name>, so a
  // reader who spots an outlier lands on that person instead of on a list they
  // then have to search by hand. Read above, with ?archived=.

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        <PeopleSection
          people={directory.people}
          chart={chart}
          canEditPeople={canEditPeople}
          trackedCount={directory.trackedCount}
          hubOnlyCount={directory.hubOnlyCount}
          archivedCount={directory.archivedCount}
          unlinkedCount={directory.unlinkedCount}
          mailboxCount={directory.mailboxCount}
          initialQuery={typeof q === "string" ? q : ""}
          includeArchived={includeArchived}
        />
      </div>
    </PageTransition>
  );
}
