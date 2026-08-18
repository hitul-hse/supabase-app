import { PageHeader } from "@/components/PageHeader";
import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireProfile } from "@/utils/supabase/require-profile";
import { getProfileView } from "@/lib/queries/profile";
import { EmploymentCard } from "./EmploymentCard";
import PageTransition from "@/components/animations/PageTransition";

export const metadata = { title: "Your profile — HSE Hub" };

export default async function ProfilePage() {
  // Every signed-in role may see their own profile, so no allowedRoles here.
  // requireProfile() already called supabase.auth.getUser() internally --
  // its return value carries the userId/email this page needs, so this
  // doesn't call getUser() a second time.
  const currentProfile = await requireProfile("/profile");

  const supabase = await createClient();
  const profile = await getProfileView(supabase, currentProfile.userId, currentProfile.email);

  if (!profile) return null; // requireProfile already redirected

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        <PageHeader
          category="HSE HUB / YOU"
          title="Your profile"
          meta="WHAT THE HUB KNOWS · WHAT YOU CONTROL"
        />

        <div className="flex flex-col gap-5 p-4 sm:p-6">
          <EmploymentCard profile={profile} />
        </div>
      </div>
    </PageTransition>
  );
}
