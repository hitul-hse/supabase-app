import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getLivePeople } from "@/lib/queries/people-live";
import { PeopleSection } from "./PeopleSection";
import PageTransition from "@/components/animations/PageTransition";

/**
 * The people directory.
 *
 * Reads `time.member` (49 real colleagues imported from TrackingTime), not the
 * seeded `public.people` mockup it used to render — eight invented rows for a
 * company of 49. See queries/people-live.ts for the full account.
 */
export default async function PeoplePage() {
  // Previously a bare requireProfile with no permission check at all, so
  // people:read_own — the key the directory exists to gate — decided nothing.
  // All four roles hold it, so this removes access from nobody; it makes the
  // toggle in /admin/roles real, which is the point.
  await requirePermission("/people", PERMISSIONS.PEOPLE_READ_OWN);
  const supabase = await createClient();

  // Both tabs render from this ONE roster. They used to read different sources,
  // so the org chart's eight mockup names shipped in the RSC payload on every
  // visit — including while the real directory was on screen.
  const directory = await getLivePeople(supabase);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        <PeopleSection
          people={directory.people}
          archivedCount={directory.archivedCount}
          unlinkedCount={directory.unlinkedCount}
          mailboxCount={directory.mailboxCount}
        />
      </div>
    </PageTransition>
  );
}
