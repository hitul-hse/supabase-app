import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getProfileView } from "@/lib/queries/profile";
import { BrandMark } from "./BrandMark";
import { SidebarNav } from "./SidebarNav";
import { SidebarToggle } from "./SidebarToggle";

async function getUserInfo() {
  const envConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!envConfigured) {
    return { status: "not configured" as const, roleKey: null };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    // getProfileView, not getCurrentProfile: it is wrapped in oncePerRequest
    // and the layout, TopBarChrome and this component all read it during the
    // same render, so the three share ONE query. This panel only needs the
    // role key out of it (the nav filter). The identity fields -- name,
    // avatar -- belong to the top bar now, and the signed avatar URL that
    // used to be minted here on every navigation is minted there, once.
    const profile = user ? await getProfileView(supabase, user.id, user.email ?? null) : null;

    return {
      status: error ? ("error" as const) : ("connected" as const),
      roleKey: profile?.roleKey ?? null,
    };
  } catch {
    return { status: "error" as const, roleKey: null };
  }
}

/**
 * Sidebar -- the split-view navigation pane (APPLE_REF §5.1). Header: brand
 * mark + collapse toggle. Body: three groups of rows. Foot: the passive
 * connection dot, and nothing else -- sign-out and the tour replay live in the
 * top bar's user menu now (§8 #30: "Avoid putting critical… actions at the
 * bottom of a sidebar").
 *
 * GEOMETRY, AND THE ONE THING THAT MOVES
 * --------------------------------------
 * Everything in the pane sits on ONE icon column. Expanded, the pane insets
 * its content 4 px (`px-1`) and every row insets its icon another 12 px
 * (`px-3`), so the 16 px icon is centred at x = 24. In the rail the pane
 * insets 12 px (`px-3`) and rows are 40 px wide with the same `px-3` inside,
 * so the icon is centred at x = 32 -- the middle of the 64 px rail -- by
 * symmetric padding alone, with no `justify-center` to special-case. The
 * brand mark and the connection dot each sit in a 40 px box on that same
 * column, so they line up with the icons in both states.
 *
 * That makes the pane's own padding (4 ↔ 12) the ONLY horizontal change at
 * the flip; rows keep their height (32 px, §3.2 "standard") and their inner
 * padding in both states, labels only fade. See DesktopSidebarShell for the
 * motion seam this leaves.
 *
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
  const { status, roleKey } = await getUserInfo();
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
        Brand header: the mark in a 40 px box on the icon column, the wordmark
        beside it, the collapse toggle at the trailing edge -- a 32 px row,
        like the nav rows under it. In the rail it stacks: mark over toggle,
        both centred on the column. The 8px "HEALTH & SAFETY EXPERTS" tagline
        went -- the only text in the app under 10px, truncated to "HEALTH &
        SAFETY E…" at 220px, i.e. a line that never once rendered in full.
      */}
      <div className="flex h-8 items-center gap-1 px-1 group-data-[collapsed=true]/sidebar:h-auto group-data-[collapsed=true]/sidebar:flex-col group-data-[collapsed=true]/sidebar:gap-1 group-data-[collapsed=true]/sidebar:px-3">
        <Link
          href="/"
          aria-label="HSE Hub — go to overview"
          className="flex min-w-0 flex-1 items-center gap-1 rounded-[var(--radius-sm)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] group-data-[collapsed=true]/sidebar:flex-none"
        >
          {/*
            Vector, and deliberately NOT animated. This mark is on screen for
            every module page all day; replaying an assemble on each navigation
            would be a stutter in the middle of someone's work, not a delight.
          */}
          <span className="flex h-8 w-10 flex-none items-center justify-center">
            <BrandMark size={26} />
          </span>
          <span className="min-w-0 truncate t-callout font-semibold tracking-[0.02em] text-[var(--text-primary)] group-data-[collapsed=true]/sidebar:hidden">
            HSE HUB
          </span>
        </Link>
        {/*
          ONE instance, always. At the trailing edge when expanded; stacked
          beneath the mark in the rail, where 64px cannot hold both side by
          side. This is the one control that changes column at the flip
          (§8 #12 keeps it in the sidebar header at both widths).

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

        Sixteen 32 px rows plus three group rules fit a 768 px laptop with the
        header and foot, so losing the scroll in rail mode costs nothing.
      */}
      <div className="flex-1 overflow-y-auto px-1 group-data-[collapsed=true]/sidebar:overflow-visible group-data-[collapsed=true]/sidebar:px-3">
        <SidebarNav roleKey={roleKey} />
      </div>

      {/*
        Foot: the connection status and nothing else. A passive dot may stay at
        the bottom of a sidebar; actions may not (§3.2 "Bottom of the window",
        §8 #30) -- sign-out and the tour replay are in the user menu. The dot
        sits in a 40 px box on the icon column; in the rail it is the whole
        signal, with the words in a title and in the accessible name.
      */}
      <div className="mt-auto border-t border-[var(--border)] px-1 pt-3 group-data-[collapsed=true]/sidebar:px-3">
        <div className="flex h-8 items-center" title={statusLabel}>
          <span className="flex h-8 w-10 flex-none items-center justify-center">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: dotColor }}
            />
          </span>
          <span className="min-w-0 truncate t-label text-[var(--text-faint)] group-data-[collapsed=true]/sidebar:hidden">
            {statusLabel.toUpperCase()}
          </span>
          {/* Always announced, even when the words are visually hidden. */}
          <span className="sr-only">{statusLabel}</span>
        </div>
      </div>
    </aside>
  );
}
