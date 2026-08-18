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
 * company of 49. See queries/people-live.ts for the full account.
 */
export default async function PeoplePage({
  searchParams,
}: {
  // Async in this Next version — awaiting is required, not optional.
  searchParams: Promise<{ q?: string }>;
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
  const [directory, chart, canEditPeople] = await Promise.all([
    getLivePeople(supabase),
    getOrgChart(supabase),
    // Whether to show the editor at all. The server actions re-check this on every
    // write, so hiding the buttons is presentation, not the security boundary.
    userHasPermission(PERMISSIONS.PEOPLE_WRITE),
  ]);

  // The Overview's utilisation rows deep-link here as /people?q=<name>, so a
  // reader who spots an outlier lands on that person instead of on a list they
  // then have to search by hand.
  const { q } = await searchParams;

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        <PeopleSection
          people={directory.people}
          chart={chart}
          canEditPeople={canEditPeople}
          archivedCount={directory.archivedCount}
          unlinkedCount={directory.unlinkedCount}
          mailboxCount={directory.mailboxCount}
          initialQuery={typeof q === "string" ? q : ""}
        />
      </div>
    </PageTransition>
  );
}
