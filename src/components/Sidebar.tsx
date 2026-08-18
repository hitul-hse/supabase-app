import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getCurrentProfile } from "@/lib/queries/auth";
import { BrandMark } from "./BrandMark";
import { SidebarNav } from "./SidebarNav";
import { LogoutButton } from "./LogoutButton";
import { TourReplayButton } from "./TourReplayButton";
import { SidebarToggle } from "./SidebarToggle";

async function getUserInfo() {
  const envConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!envConfigured) {
    return { status: "not configured" as const, email: null, roleKey: null, roleDisplayName: null };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    const profile = user ? await getCurrentProfile(supabase, user.id, user.email ?? null) : null;

    return {
      status: error ? ("error" as const) : ("connected" as const),
      email: user?.email ?? null,
      roleKey: profile?.roleKey ?? null,
      roleDisplayName: profile?.roleDisplayName ?? null,
    };
  } catch {
    return { status: "error" as const, email: null, roleKey: null, roleDisplayName: null };
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
  const { status, email, roleKey, roleDisplayName } = await getUserInfo();
  const dotColor =
    status === "connected" ? "var(--good)" : status === "error" ? "var(--critical)" : "var(--warning)";
  const statusLabel =
    status === "connected" ? "Supabase Live" : status === "error" ? "Supabase Error" : "Not Configured";

  /*
    Initials, not a photograph we do not have. The previous placeholder was a
    diagonal-stripe swatch, which is identical for every user and therefore
    carries no information -- in the rail, where the email is clipped away, it
    would be the ONLY identity cue and would say nothing at all.
  */
  const initials = (email ?? "")
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "—";

  return (
    <aside
      className="flex h-full w-full flex-none flex-col gap-4 border-r border-[var(--border)] bg-[var(--sidebar)] py-4"
      data-testid="sidebar-panel"
    >
      {/*
        Brand header. In the rail it centres to just the mark: "HSE HUB" plus
        the company line cannot fit in 64px, and a truncated wordmark reads as
        a bug rather than as a brand.
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
          <div className="flex min-w-0 flex-col leading-[1.15] transition-opacity duration-150 group-data-[collapsed=true]/sidebar:hidden">
            <span className="font-sans text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
              HSE HUB
            </span>
            <span className="truncate font-mono text-[8px] tracking-[0.14em] text-[var(--text-faint)]">
              HEALTH &amp; SAFETY EXPERTS
            </span>
          </div>
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

      {/* User profile & Supabase status footer */}
      <div className="mt-auto flex flex-col gap-2.5 border-t border-[var(--border)] px-4 pt-3 group-data-[collapsed=true]/sidebar:items-center group-data-[collapsed=true]/sidebar:px-2">
        <div className="group/who relative flex w-full items-center gap-2.5 group-data-[collapsed=true]/sidebar:w-auto group-data-[collapsed=true]/sidebar:justify-center">
          <span
            aria-hidden
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--accent-wash)] font-mono text-[10px] font-semibold tracking-[0.02em] text-[var(--accent)] ring-1 ring-inset ring-[var(--border-strong)]"
          >
            {initials}
          </span>
          <div className="flex min-w-0 flex-col group-data-[collapsed=true]/sidebar:hidden">
            <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">
              {email ?? "Not signed in"}
            </span>
            <span className="font-mono text-[9.5px] text-[var(--text-faint)]">
              {roleDisplayName ? roleDisplayName.toUpperCase() : email ? "PENDING ACCESS" : "—"}
            </span>
          </div>

          {/*
            In the rail the initials are the only identity cue, and initials
            alone are ambiguous across a 49-person company -- so the tooltip
            carries the full address and role.
          */}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-[calc(100%+8px)] z-50 hidden whitespace-nowrap rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] opacity-0 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.5)] transition-opacity duration-150 group-hover/who:opacity-100 pointer-fine:group-data-[collapsed=true]/sidebar:block"
          >
            {email ?? "Not signed in"}
            {roleDisplayName ? (
              <span className="ml-1.5 font-mono text-[10px] text-[var(--text-faint)]">
                {roleDisplayName.toUpperCase()}
              </span>
            ) : null}
          </span>
        </div>

        {email && <LogoutButton />}
        {email && <TourReplayButton />}

        {/*
          Connection status. In the rail it reduces to the dot alone, with the
          words in a title -- the dot is the signal, the text is the detail.
        */}
        <div
          className="flex items-center gap-2 pt-1 group-data-[collapsed=true]/sidebar:pt-0"
          title={statusLabel}
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 flex-none rounded-full"
            style={{ background: dotColor }}
          />
          <span className="font-mono text-[9.5px] tracking-[0.02em] text-[var(--text-faint)] group-data-[collapsed=true]/sidebar:hidden">
            {statusLabel.toUpperCase()}
          </span>
          {/* Always announced, even when the words are visually hidden. */}
          <span className="sr-only">{statusLabel}</span>
        </div>
      </div>
    </aside>
  );
}
