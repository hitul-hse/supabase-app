import { PageHeader } from "@/components/PageHeader";
import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireProfile } from "@/utils/supabase/require-profile";
import { getProfileView } from "@/lib/queries/profile";
import { EmploymentCard } from "./EmploymentCard";
import { IdentityCard } from "./IdentityCard";
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

  // The bucket is private, so the stored key is not itself fetchable. One
  // hour is longer than anyone will sit on this page and short enough that a
  // leaked URL expires on its own.
  let signedAvatarUrl: string | null = null;
  if (profile.avatarUrl) {
    const { data } = await supabase.storage
      .from("avatars")
      .createSignedUrl(profile.avatarUrl, 3600);
    signedAvatarUrl = data?.signedUrl ?? null;
  }

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
          <IdentityCard profile={profile} signedAvatarUrl={signedAvatarUrl} />
          <EmploymentCard profile={profile} />
        </div>
      </div>
    </PageTransition>
  );
}
