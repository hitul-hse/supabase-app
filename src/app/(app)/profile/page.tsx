import { PageHeader } from "@/components/PageHeader";
import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireProfile } from "@/utils/supabase/require-profile";
import { getProfileView } from "@/lib/queries/profile";
import { EmploymentCard } from "./EmploymentCard";
import { IdentityCard } from "./IdentityCard";
import { PreferencesCard } from "./PreferencesCard";
import { SecurityCard } from "./SecurityCard";
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

  // Not the same thing requireProfile() already checked. requireProfile()
  // calls getCurrentProfile() (src/lib/queries/auth.ts) -- a different query
  // with its own select list -- and redirects to /access-pending if THAT
  // finds no active profile. getProfileView() can still legitimately return
  // null afterwards (e.g. the row was deactivated in the moment between the
  // two calls, or a data anomaly leaves no app_role join). A genuine query
  // failure no longer reaches here at all -- getProfileView() throws for
  // that case, which (app)/error.tsx's route boundary catches. This is only
  // the narrow, real "no profile to show" case, so it gets its own message
  // rather than a blank page.
  if (!profile) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-[15px] font-semibold text-[var(--text-primary)]">
          We couldn&apos;t find your profile
        </h1>
        <p className="max-w-[48ch] text-[12px] leading-relaxed text-[var(--text-muted)]">
          Your account looked provisioned a moment ago, but no active profile record could be
          read just now. Reloading the page usually resolves this; contact an administrator if it
          persists.
        </p>
      </div>
    );
  }

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
          <SecurityCard />
          <PreferencesCard profile={profile} />
        </div>
      </div>
    </PageTransition>
  );
}
