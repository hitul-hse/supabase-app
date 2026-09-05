import { createClient } from "@/utils/supabase/server";
import { getProfileView } from "@/lib/queries/profile";
import { IconButtonLink } from "./ui/Segmented";
import { IconSearch } from "./nav-icons";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleSwitcher } from "./locale/LocaleSwitcher";
import { UserMenu } from "./UserMenu";

/**
 * The top bar's right-hand chrome: find, and who you are signed in as.
 *
 * WHY THIS IS ITS OWN COMPONENT AND NOT INLINE IN THE LAYOUT
 * ---------------------------------------------------------
 * It is a server component that queries the profile. The LAYOUT renders it
 * exactly once and hands the result to `TopBarChromeProvider`; every
 * `PageHeader` shows it through `TopBarChromeSlot` by default, so no page has
 * to remember to pass it and no page can render a subtly different bar. (It
 * was a per-page `chrome` prop before, and one page passed it -- every other
 * page shipped without a /profile entry point.)
 *
 * WHAT IT DELIBERATELY DOES NOT INCLUDE
 * -------------------------------------
 * The reference layout shows a bell with a red dot beside the user chip. There
 * is no notification system in this app -- no table, no producer, no read state
 * -- so a bell here would be a control that either does nothing or navigates to
 * an empty page, and the red dot would be a permanent unread badge for zero
 * unread items. That is the same class of defect as the old SyncBar claiming
 * "ASANA 4m ok" for a pipeline that never ran: chrome that asserts something
 * untrue. It is omitted until there is something to notify about.
 *
 * The search button navigates to /people?focus=1 rather than opening a command
 * palette. People search is the one search this app actually has (the roster
 * filter on /people, already built and gated), so the control goes where the
 * capability is instead of promising a global search that does not exist.
 */
export async function TopBarChrome() {
  const envConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!envConfigured) return null;

  let email: string | null = null;
  let displayName: string | null = null;
  let roleDisplayName: string | null = null;
  let signedAvatarUrl: string | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    email = user.email ?? null;
    const profile = await getProfileView(supabase, user.id, user.email ?? null);
    displayName = profile?.effectiveName ?? null;
    roleDisplayName = profile?.roleDisplayName ?? null;

    if (profile?.avatarUrl) {
      const { data } = await supabase.storage
        .from("avatars")
        .createSignedUrl(profile.avatarUrl, 3600);
      signedAvatarUrl = data?.signedUrl ?? null;
    }
  } catch {
    // A failed profile read must not take the whole page down with it -- the
    // header is chrome, and the content below it is what the user came for.
    return null;
  }

  const identityLabel = displayName ?? email ?? "Account";

  return (
    <>
      {/* Theme first, then find: the toggle is the control people asked for by
          name, and the reference bars put appearance controls at the outer edge. */}
      <LocaleSwitcher />
      <ThemeToggle />

      <IconButtonLink
        href="/people?focus=1"
        label="Find a person"
        data-testid="topbar-search"
      >
        <IconSearch />
      </IconButtonLink>

      {/*
        The identity chip opens the account menu -- Profile, Replay tour, Log
        out -- and is the one /profile entry point at every width. A client
        component, because a menu needs open state and focus management; it
        gets plain strings, never the Supabase client.
      */}
      <UserMenu
        name={identityLabel}
        email={email}
        role={roleDisplayName}
        avatarUrl={signedAvatarUrl}
      />
    </>
  );
}
