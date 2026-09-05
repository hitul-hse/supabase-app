import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getProfileView } from "@/lib/queries/profile";
import { BrandMark } from "./BrandMark";
import { SidebarNav } from "./SidebarNav";
import { LogoutButton } from "./LogoutButton";
import { TourReplayButton } from "./TourReplayButton";
import { SidebarToggle } from "./SidebarToggle";

async function getUserInfo() {
  const envConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!envConfigured) {
    return {
      status: "not configured" as const,
      email: null,
      roleKey: null,
      roleDisplayName: null,
      displayName: null,
      signedAvatarUrl: null,
    };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    // getProfileView (not getCurrentProfile) -- it's the superset this
    // component now needs: roleKey/roleDisplayName as before, plus
    // effectiveName and avatarUrl for the chip. One query instead of two.
    //
    // That superset is wider than the chip actually renders, and every page
    // pays for it now: getProfileView's select also pulls
    // pref_landing_page/pref_locale/pref_sidebar_collapsed and joins
    // people(name, employee_number, contract_hours, holiday_left,
    // total_holiday, certificate_status, since) -- none of which the sidebar
    // uses. Accepted rather than routing around it, because the alternative
    // is a THIRD near-duplicate profile query (getCurrentProfile already
    // exists for "just the identity fields"; getProfileView exists for
    // "everything /profile renders"): one more narrow variant would mean
    // three overlapping queries to keep in sync instead of two, which is a
    // worse drift risk than one extra join on a single row this component
    // was already querying per render. The added cost itself is one extra
    // join against a row scoped to a single user_id (indexed, cheap) --
    // not a new query, and not proportional to org size.
    const profile = user ? await getProfileView(supabase, user.id, user.email ?? null) : null;

    // The bucket is private, so the stored key isn't itself fetchable --
    // same signing call page.tsx makes. This DOES mean every server render
    // of the sidebar (i.e. every navigation) mints a fresh signed URL over
    // the network when the user has a photo. Considered and accepted rather
    // than cached: (a) it only fires for accounts with a photo -- most rows
    // have none, so most renders skip it entirely; (b) this component
    // already pays one Supabase query per render (the profile join) that
    // this is additive to, not a new order of cost; (c) a cached signed URL
    // would need its own invalidation wired to the avatar actions'
    // revalidatePath("/", "layout") to avoid ever showing a stale/expired
    // link after a photo change -- extra machinery not justified for a
    // 49-person internal portal. One hour of validity is longer than a
    // single page view needs regardless.
    let signedAvatarUrl: string | null = null;
    if (profile?.avatarUrl) {
      const { data } = await supabase.storage
        .from("avatars")
        .createSignedUrl(profile.avatarUrl, 3600);
      signedAvatarUrl = data?.signedUrl ?? null;
    }

    return {
      status: error ? ("error" as const) : ("connected" as const),
      email: user?.email ?? null,
      roleKey: profile?.roleKey ?? null,
      roleDisplayName: profile?.roleDisplayName ?? null,
      displayName: profile?.effectiveName ?? null,
      signedAvatarUrl,
    };
  } catch {
    return {
      status: "error" as const,
      email: null,
      roleKey: null,
      roleDisplayName: null,
      displayName: null,
      signedAvatarUrl: null,
    };
  }
}

/**
 * @param showCollapseControl
 *   Whether to render the hide-sidebar button. Defaults to false because this
 *   component is mounted TWICE -- once in the desktop shell and once inside the
 *   mobile drawer -- and two buttons carrying the same test id and aria-label
 *   is an ambiguous accessible name for screen reader users, plus a strict-mode
 *   violation for any automation. Only the desktop instance opts in; the drawer
 *   already has its own close affordance.
 */
export async function Sidebar({
  showCollapseControl = false,
}: { showCollapseControl?: boolean } = {}) {
  const { status, email, roleKey } = await getUserInfo();
  const dotColor =
    status === "connected" ? "var(--good)" : status === "error" ? "var(--critical)" : "var(--warning)";
  const statusLabel =
    status === "connected" ? "Supabase Live" : status === "error" ? "Supabase Error" : "Not Configured";

  return (
    <aside
      className="flex h-full w-full flex-none flex-col gap-4 border-r border-[var(--border)] bg-[var(--sidebar)] py-4"
      data-testid="sidebar-panel"
    >
      {/*
        Brand header: the mark and the wordmark, nothing under them. The 8px
        "HEALTH & SAFETY EXPERTS" tagline went -- the only text in the app
        under 10px, truncated to "HEALTH & SAFETY E…" at 220px, i.e. a line
        that never once rendered in full. In the rail it centres to just the
        mark: a truncated wordmark reads as a bug rather than as a brand.
      */}
      <div className="flex items-center gap-2 px-4 group-data-[collapsed=true]/sidebar:flex-col group-data-[collapsed=true]/sidebar:gap-3 group-data-[collapsed=true]/sidebar:px-0">
        <Link
          href="/"
          aria-label="HSE Hub — go to overview"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-sm)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] group-data-[collapsed=true]/sidebar:flex-none"
        >
          {/*
            Vector, and deliberately NOT animated. This mark is on screen for
            every module page all day; replaying an assemble on each navigation
            would be a stutter in the middle of someone's work, not a delight.
          */}
          <BrandMark size={26} className="flex-none" />
          <span className="min-w-0 truncate t-callout font-semibold tracking-[0.02em] text-[var(--text-primary)] transition-opacity duration-150 group-data-[collapsed=true]/sidebar:hidden">
            HSE HUB
          </span>
        </Link>
        {/*
          ONE instance, always. Beside the brand when expanded; stacked beneath
          it in the rail, where 64px cannot hold both side by side.

          Deliberately not two CSS-hidden copies: both would sit in the DOM with
          the same test id and accessible name, which is an ambiguous target for
          a screen reader and a strict-mode violation for automation.

          Outside the <Link>, not inside it -- a button nested in an anchor is
          invalid HTML and every click would navigate as well as toggle.
        */}
        {showCollapseControl && <SidebarToggle />}
      </div>

      {/*
        Navigation.

        EXPANDED it scrolls, so it clips: `overflow-y-auto` implies a clipping
        box on both axes, which is correct for a 220px panel of labelled rows.

        COLLAPSED it must NOT clip -- the rail tooltips are absolutely
        positioned just outside the 64px edge, and any scroll container here
        cuts them in half. `overflow-visible` also removes the scrollbar, which
        matters more than it sounds: a 10px scrollbar eats the right-hand 10px
        of a 64px rail and shifts every icon 5px off centre. That is exactly
        what the visual probe caught.

        Nine icon rows fit any realistic viewport, so losing the scroll in rail
        mode costs nothing.
      */}
      <div className="flex-1 overflow-y-auto px-1 group-data-[collapsed=true]/sidebar:overflow-visible group-data-[collapsed=true]/sidebar:px-2">
        <SidebarNav roleKey={roleKey} />
      </div>

      {/*
        Footer: two rows in nav-row geometry, then the connection status.

        The identity chip that used to lead this footer is gone. It was the
        THIRD copy of "who am I" on one screen -- the top bar's user chip is
        the one /profile entry at every width (PageHeader mounts TopBarChrome
        on mobile too), and the tour's welcome names the reader again. A chip
        at the bottom of a 220px panel is also the least-looked-at pixel on
        screen, which is why the entry moved to the top bar in the first
        place. What is left is what only the sidebar does: sign out, replay
        the tour, and say whether the database is live.
      */}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-[var(--border)] px-1 pt-3 group-data-[collapsed=true]/sidebar:items-center group-data-[collapsed=true]/sidebar:px-2">
        {email && <LogoutButton />}
        {email && <TourReplayButton />}

        {/*
          Connection status. In the rail it reduces to the dot alone, with the
          words in a title -- the dot is the signal, the text is the detail.
        */}
        <div
          className="flex items-center gap-2 px-3 pt-2 group-data-[collapsed=true]/sidebar:px-0 group-data-[collapsed=true]/sidebar:pt-1"
          title={statusLabel}
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 flex-none rounded-full"
            style={{ background: dotColor }}
          />
          <span className="t-label text-[var(--text-faint)] group-data-[collapsed=true]/sidebar:hidden">
            {statusLabel.toUpperCase()}
          </span>
          {/* Always announced, even when the words are visually hidden. */}
          <span className="sr-only">{statusLabel}</span>
        </div>
      </div>
    </aside>
  );
}
