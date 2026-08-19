import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getProfileView } from "@/lib/queries/profile";
import { Avatar } from "./Avatar";
import { IconButtonLink } from "./ui/Segmented";
import { IconSearch } from "./nav-icons";

/**
 * The top bar's right-hand chrome: find, and who you are signed in as.
 *
 * WHY THIS IS ITS OWN COMPONENT AND NOT INLINE IN THE LAYOUT
 * ---------------------------------------------------------
 * It is a server component that queries the profile, and it is rendered from
 * `PageHeader`'s `chrome` slot on every page. Inlining it would mean either
 * every page repeating the query, or the layout passing a rendered tree down
 * through props -- and the first is how three subtly different top bars happen.
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
      <IconButtonLink
        href="/people?focus=1"
        label="Find a person"
        data-testid="topbar-search"
      >
        <IconSearch />
      </IconButtonLink>

      {/*
        The chip is a LINK to /profile, and it carries the name as text on
        desktop rather than relying on the monogram alone: across a 49-person
        company two colleagues share initials often enough that an avatar is not
        an identity. Below `sm` the name is dropped and the avatar's own
        aria-label carries it, because a full name plus a role in a 390px bar
        pushes the page title off screen.
      */}
      <Link
        href="/profile"
        data-testid="topbar-user"
        className="flex flex-none items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] py-1 pl-1 pr-1 transition-colors duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] sm:pr-3"
      >
        <Avatar name={identityLabel} src={signedAvatarUrl} size={24} />
        <span className="hidden min-w-0 flex-col leading-tight sm:flex">
          <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">
            {identityLabel}
          </span>
          {roleDisplayName && (
            <span className="truncate font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)]">
              {roleDisplayName.toUpperCase()}
            </span>
          )}
        </span>
      </Link>
    </>
  );
}
