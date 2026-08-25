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
  const tabs = mobileTabsFor(roleKey);

  /* A route NOT in the tab bar (say /admin/roles) must still show as active
     somewhere, or the bar claims you are nowhere. It lights "More" instead —
     the tab that would take you back to it. */
  const onATab = tabs.some((t) =>
    t.href === "/" ? pathname === "/" : pathname === t.href || pathname?.startsWith(`${t.href}/`),
  );

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
        While the bar was flush to the bottom it needed pb-[env(...)] INSIDE
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
      className="card-elev-glass surface-translucent fixed inset-x-0 bottom-[calc(12px+env(safe-area-inset-bottom))] z-30 mx-4 overflow-hidden rounded-full border border-[var(--glass-edge)] lg:hidden"
    >
      <ul className="flex items-stretch">
        {tabs.map((tab) => {
          const Icon = NAV_ICONS[tab.href] ?? IconDot;
          const active =
            !moreOpen &&
            (tab.href === "/"
              ? pathname === "/"
              : pathname === tab.href || pathname?.startsWith(`${tab.href}/`));

          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                data-testid={`tab-${tab.href}`}
                aria-current={active ? "page" : undefined}
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
                className={`relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${
                  active ? "text-[var(--glass-text-active)]" : "text-[var(--glass-text)]"
                }`}
              >
                {/* A DOT BELOW THE LABEL, not the bar flush to the top edge it
                    used to be. That bar was drawn against a straight top
                    border; the pill has a 20px corner radius and clips its own
                    overflow, so on the first and last tab the marker's end now
                    disappears into the curve — present, wrong, and only visible
                    on two of five tabs.

                    A filled pill (the sidebar's active shape) still does not
                    fit: at ~71px wide it either clips the label or forces the
                    icon off-centre.

                    Absolutely positioned, so it costs the flex column no
                    height and cannot squeeze the 44px target.

                    The marker is a FILL, not text, so WCAG's 3:1 non-text
                    floor applies rather than 4.5 — deliberately a different
                    token from the label.

                    --accent-hover, not --accent. Re-measured on the specular
                    band over the worst backdrop, --accent falls to 2.80 — an
                    outright FAIL of the 3:1 non-text floor, where it merely had
                    thin margin before. --accent-hover is the same hue at 3.37.

                    This is the cost of the brighter band, and it is why the
                    band is capped: every element on this surface has to be
                    re-measured when the pane moves, not just the labels. */}
                <span
                  aria-hidden
                  className={`absolute bottom-[7px] h-[3px] w-[3px] rounded-full transition-opacity ${
                    active ? "bg-[var(--accent-hover)] opacity-100" : "opacity-0"
                  }`}
                />
                <Icon className="h-[18px] w-[18px]" />
                {/* 10px is the floor here, and it is a deliberate exception to
                    the app's 11px minimum: the label must survive at 390/5 =
                    78px per tab. `truncate` rather than wrap — two-line labels
                    make the bar 76px tall and eat a tenth of the viewport. */}
                <span className="w-full truncate text-center text-[10px] leading-none tracking-[0.02em]">
                  {tab.short}
                </span>
              </Link>
            </li>
          );
        })}

        <li className="flex-1">
          <button
            type="button"
            onClick={onOpenMore}
            data-testid="tab-more"
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            aria-label="More navigation"
            className={`relative flex min-h-[56px] w-full flex-col items-center justify-center gap-1 px-1 py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${
              moreOpen || !onATab ? "text-[var(--glass-text-active)]" : "text-[var(--glass-text)]"
            }`}
          >
            <span
              aria-hidden
              className={`absolute bottom-[7px] h-[3px] w-[3px] rounded-full transition-opacity ${
                moreOpen || !onATab ? "bg-[var(--accent-hover)] opacity-100" : "opacity-0"
              }`}
            />
            <IconMore className="h-[18px] w-[18px]" />
            <span className="w-full truncate text-center text-[10px] leading-none tracking-[0.02em]">
              More
            </span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

export { MOBILE_TAB_HREFS };
