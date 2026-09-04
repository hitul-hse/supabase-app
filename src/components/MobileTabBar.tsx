"use client";

/**
 * MobileTabBar — the phone's primary navigation: a fixed bottom tab bar with
 * the four routes somebody actually opens the Hub for, plus a "More" tab that
 * opens the existing drawer for everything else.
 *
 * WHY THIS EXISTS. Before it, changing page on a phone cost TWO taps and a
 * 300ms drawer animation: reach the hamburger in the TOP-LEFT corner, wait,
 * then pick. Top-left is the furthest point from a right thumb on a 390x844
 * screen — the one corner you have to shift your grip to reach. Every one of
 * the four mobile references this was built from puts primary navigation in a
 * bottom bar, and measuring them agrees: the language-learning reference has
 * structural band edges at 85/90/96% of its height, which is a tab bar.
 *
 * FOUR TABS, NOT NINE. The sidebar's nine entries do not fit: at 390px, nine
 * targets are 43px wide, under the 44px minimum, and the labels truncate to
 * nothing. Four plus More keeps every target ≥44px AND keeps the drawer as the
 * complete list, so nothing becomes unreachable — which is the trap with tab
 * bars, not the width.
 *
 * IT REUSES NAV_GROUPS. The tabs are resolved from the same array the sidebar
 * renders, through the same role filter. A hardcoded copy would drift: an exec
 * route would appear for an employee the first time somebody edited one list
 * and not the other, and the failure is silent — a tab that 403s on tap.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconDot, NAV_ICONS } from "./nav-icons";
import { MOBILE_TAB_HREFS, mobileTabsFor } from "./mobile-tabs-shared";
import { NAV_GROUPS } from "./SidebarNav";
import { isNavItemVisible } from "./nav-access";

/** The "More" glyph — three dots, matching the 16×16 / 1.5-stroke house rule
 *  the rest of nav-icons.tsx follows. Not an ellipsis character: a text glyph
 *  inherits the text font and sits at a visibly different weight beside the
 *  stroked icons either side of it. */
function IconMore({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <circle cx="3" cy="8" r="1.35" fill="currentColor" />
      <circle cx="8" cy="8" r="1.35" fill="currentColor" />
      <circle cx="13" cy="8" r="1.35" fill="currentColor" />
    </svg>
  );
}

export function MobileTabBar({
  roleKey,
  onOpenMore,
  moreOpen,
}: {
  roleKey: string | null;
  onOpenMore: () => void;
  moreOpen: boolean;
}) {
  const pathname = usePathname();

  /*
    THE ALLOW-LIST ARGUMENT WAS NEVER PASSED, and that was a live bug waiting
    for its first restricted role.

    `mobileTabsFor(roleKey)` with no second argument means "every tab href is
    allowed" — its own doc says so, on the reasoning that the four defaults
    carry no `roles` gate in NAV_GROUPS. True then, and it made the module's
    other claim ("a tab can never appear for a role the sidebar hides it from")
    false: the bar was not applying the sidebar's filter, it was relying on
    there being nothing to filter. The moment a role is restricted to one page,
    a phone shows it four tabs to pages that redirect on tap.

    So the set is now computed from the REAL nav data through the REAL
    predicate, which is what the module always claimed. For every unrestricted
    role this produces exactly the four hrefs it produced before.
  */
  const allowedHrefs = new Set(
    NAV_GROUPS.flatMap((g) => g.items)
      .filter((item) => isNavItemVisible(roleKey, item))
      .map((item) => item.href),
  );
  const tabs = mobileTabsFor(roleKey, allowedHrefs);

  /* A route NOT in the tab bar (say /admin/roles) must still show as active
     somewhere, or the bar claims you are nowhere. It lights "More" instead —
     the tab that would take you back to it. */
  const onATab = tabs.some((t) =>
    t.href === "/" ? pathname === "/" : pathname === t.href || pathname?.startsWith(`${t.href}/`),
  );

  /* Exactly ONE tab is filled at any moment, and this is what guarantees it:
     "More" takes the pill when the drawer is open OR when the current route is
     not one of the four tabs. Without the single source of truth, a route like
     /admin/roles would fill nothing and the bar would claim you are nowhere —
     or worse, both a route tab and More could fill at once and two labels would
     compete for the same row. */
  const moreActive = moreOpen || !onATab;

  return (
    <nav
      aria-label="Primary"
      data-testid="mobile-tab-bar"
      /*
        FLOATING, not edge-anchored. The bar is a detached pill inset from all
        three edges, per the references — the designer's own stated reason on
        the E-Commerce shot (Anitei, 27259789) is "maximize screen space".

        rounded-full, NOT rounded-[var(--radius-panel)]. The earlier 20px came
        from a BAD MEASUREMENT of that reference: "~18px radius" was read in
        raw pixels off a 3200x2400 export, which says nothing about a 58px-tall
        bar on a 390px phone. Re-measured scale-invariantly, the reference bar
        is 37px tall and its fill reaches full width at dy=15 of 37 — radius is
        HALF ITS HEIGHT, i.e. a true pill. At our 58px height that is 29px, and
        `rounded-full` expresses "always a pill" rather than pinning a number
        that silently stops being a pill the moment the bar's height changes.

        THE SAFE AREA MOVED, and this is the part that breaks if you skim it.
        While the bar was flush to the bottom it needed pb-[env(safe-area-inset-bottom)] INSIDE
        itself, or its labels sat under the home indicator. A floating bar
        does not touch the bottom edge, so the inset belongs BELOW it instead:
        bottom-[calc(12px+env(safe-area-inset-bottom))]. Keeping the old inner
        padding as well would double-count it — ~34px of dead space inside the
        pill on every notched iPhone, and a visibly lopsided bar.

        mx-4 (16px) rather than the reference's ~7%: at 390px that is 27px a
        side, which costs each of five targets ~11px of width for no gain. 16px
        reads as clearly detached and keeps every target at 71px.

        card-elev-glass, NOT shadow-[var(--shadow-glass)]. Tailwind v4 emits
        no rule for that arbitrary-value form — it compiles clean and renders a
        FULLY TRANSPARENT shadow. This codebase already shipped that bug once
        (globals.css). Deeper than .card-elev-raised because this is the only
        surface that floats over the PAGE rather than sitting on a card.

        surface-translucent gives the bar a SPECULAR GRADIENT (not a flat tint)
        over a 28px backdrop blur at 180% saturation. That class (globals.css)
        carries the gradient, the blur, the @supports guard and the
        prefers-reduced-transparency fallback.

        WHY A GRADIENT AND A BRIGHT RIM, rather than "a lighter tint". The bar
        first failed by being tinted DARKER than --page (separation 1.033, a
        hole cut in the page). The obvious repair — keep brightening the flat
        fill — does not work, and the sweep says so plainly: separation and
        legibility move in OPPOSITE directions, one for one.

          tint      a     sep    worst idle label (over an --accent fill)
          #2f3742  0.72   1.330   5.71   <- reads as a solid slate SLAB
          #454f60  0.72   1.717   4.41   FAILS 4.5
          #68758c  0.72   2.652   2.98   FAILS badly
          #7c8899  0.72   3.260   2.52   FAILS badly

        So no flat fill can both pop and stay readable. The lift comes from the
        two elements that cost text NOTHING, because labels sit in the MIDDLE of
        the bar rather than on its edge:

          - the RIM at 0.36 (was 0.16): separation 4.57 vs --page, where 0.16
            gave only 2.52 — under the 3:1 non-text floor, which is why the bar
            looked flat against black however transparent it was;
          - the GRADIENT + inset specular: a single flat tone has no light
            source and no curvature, so it reads as a widget however
            transparent. Bright at the top where light catches the pill.

        The fill itself stayed dark (top separation 1.533) precisely so the
        labels keep 4.97 / 5.95 of headroom.

        It replaces bg-[var(--sidebar)] rather than sitting alongside it: a
        Tailwind bg-* utility would win on specificity and silently re-opaque
        the bar while every other assertion here passed.
      */
      className="card-elev-glass surface-translucent fixed inset-x-0 bottom-[calc(12px+env(safe-area-inset-bottom))] z-30 mx-4 rounded-full border border-[var(--glass-edge)] lg:hidden"
    >
      {/*
        p-1.5 gives the inner pill room to breathe inside the bar. Without it
        the filled pill's edge would touch the bar's own rim and the two radii
        would fight each other visually.

        NOTE: `overflow-hidden` was REMOVED from the <nav> above. It existed to
        clip the old top-flush marker, which no longer exists; with the filled
        pill it clipped the pill's own shadow on the first and last tab. The bar
        is already `rounded-full`, and every child is inside its bounds, so
        nothing needs clipping.
      */}
      <ul className="flex items-stretch gap-0.5 p-1.5">
        {tabs.map((tab) => {
          const Icon = NAV_ICONS[tab.href] ?? IconDot;
          const active =
            !moreOpen &&
            (tab.href === "/"
              ? pathname === "/"
              : pathname === tab.href || pathname?.startsWith(`${tab.href}/`));

          return (
            /*
              THE ACTIVE TAB GROWS, the idle ones shrink. `flex-1` on every tab
              (the old behaviour) gives five equal 71px columns, which is what
              forced the label down to 10px and made it truncate. The reference
              instead lets the active pill take the width its label needs and
              leaves the rest as icon-only squares:

                idle   -> flex-none, 44px wide  (a square icon target)
                active -> flex-1,    fills the remainder

              At 390px that is 4 x 44 + pill = 176 + ~190px of pill, so the
              label reads at 12px with no truncation — where five equal columns
              could not fit "Tracking" at 10px.
            */
            <li key={tab.href} className={active ? "min-w-0 flex-1" : "flex-none"}>
              <Link
                href={tab.href}
                data-testid={`tab-${tab.href}`}
                aria-current={active ? "page" : undefined}
                /* The label is hidden on idle tabs, so the icon alone is the
                   accessible name. An aria-label keeps every tab announced by
                   its route rather than as a bare "link". */
                aria-label={tab.short}
                /* `relative` anchors the active marker below. Without it the
                   marker positions against the nearest positioned ancestor —
                   the fixed <nav> — and every tab's marker stacks in the
                   top-left corner of the bar. */
                /*
                  --glass-text / --glass-text-active, NOT the app-wide
                  --text-secondary / --accent-hover.

                  A translucent surface's luminance moves with whatever scrolls
                  under it, so its text cannot inherit tokens tuned against a
                  fixed opaque surface. Measured on the NEW lighter pane over
                  its worst backdrop (an --accent fill): --text-secondary
                  (#bcc1c4) gives 3.07, a clear fail, while --glass-text
                  (#e8ebed) gives 4.65 and --glass-text-active (#ffffff) 5.57.

                  That headroom is what PAID for the lighter, more transparent
                  pane — the tint could not move without the labels moving too.
                  Light theme keeps app-token values (5.76 / 6.52) and inverts
                  the hierarchy: on a white pane, active is DARKER than idle.
                */
                /*
                  A FILLED PILL, horizontal, not a vertical icon-over-label
                  stack with a dot underneath.

                  --accent-hover as the fill, NOT --accent. Measured against the
                  three backdrops this floating pane sits over (--page, an
                  --accent fill, --surface), an --accent pill reaches only 2.80
                  against the composited pane in dark theme — an outright FAIL of
                  the 3:1 non-text floor, i.e. the pill visibly dissolves into
                  the bar exactly where it is meant to say "you are here".
                  --accent-hover is the same hue at 3.30 dark / 6.15 light.

                  --accent-contrast for the label (#1c2427 dark / #ffffff
                  light): 9.39 / 7.44 on that fill. NOT --glass-text, which is
                  tuned for the translucent pane and would sit light-on-light.

                  min-h-[44px] not [56px]: the bar's own p-1.5 adds 12px, so the
                  bar stays 56px+ overall while each target is a clean 44.
                */
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-full px-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                  active
                    ? "bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
                    : "text-[var(--glass-text)]"
                }`}
              >
                {/* The marker DOT is gone. It existed because every tab looked
                    identical, so "here" needed a separate 3px signal — which is
                    the weakest possible one at arm's length. The pill IS the
                    signal now: a filled shape the eye finds without looking for
                    it. One element instead of two, and no 3px fill to re-measure
                    every time the pane's luminance moves. */}
                <Icon className="h-[20px] w-[20px] flex-none" />
                {/*
                  RENDERED ONLY WHEN ACTIVE, and only ONE tab is ever active, so
                  exactly one label is on screen at a time. That is what buys the
                  size: 12px with no truncation, where five permanent labels
                  forced 10px AND still truncated "Tracking".

                  Idle tabs keep their aria-label (above), so nothing is lost to
                  a screen reader — the label is visually redundant with the
                  icon, not informational.
                */}
                {active ? (
                  <span className="truncate text-[12px] font-medium leading-none tracking-[0.01em]">
                    {tab.short}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}

        {/* "More" follows the exact same anatomy as a route tab — filled when it
            is the current context, icon-only otherwise. It is deliberately NOT a
            permanently-labelled odd-one-out: a bar with one always-labelled tab
            reads as a mistake rather than a distinction. */}
        <li className={moreActive ? "min-w-0 flex-1" : "flex-none"}>
          <button
            type="button"
            onClick={onOpenMore}
            data-testid="tab-more"
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            aria-label="More navigation"
            className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full px-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              moreActive
                ? "bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
                : "text-[var(--glass-text)]"
            }`}
          >
            <IconMore className="h-[20px] w-[20px] flex-none" />
            {moreActive ? (
              <span className="truncate text-[12px] font-medium leading-none tracking-[0.01em]">
                More
              </span>
            ) : null}
          </button>
        </li>
      </ul>
    </nav>
  );
}

export { MOBILE_TAB_HREFS };
