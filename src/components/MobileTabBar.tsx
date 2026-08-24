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
        pb-[env(safe-area-inset-bottom)] is load-bearing, not defensive. On any
        iPhone with a home indicator the bottom ~34px is reserved: without this
        the row of labels sits UNDER the indicator and the bottom third of every
        tap target is swallowed by the system's own swipe gesture. There was no
        safe-area handling anywhere in this codebase before this component.
      */
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--sidebar)] pb-[env(safe-area-inset-bottom)] lg:hidden"
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
                  --accent-hover / --text-secondary, NOT --accent /
                  --text-faint. Measured on the rendered bar in BOTH themes:
                  in LIGHT mode --text-faint on --sidebar is 4.49:1 and --accent
                  is 4.19:1, i.e. the ACTIVE tab was the worst text on the bar
                  and both failed the 4.5 floor for 10px type. Both tokens pass
                  comfortably on the dark sidebar, which is why reading them
                  there alone would have shipped this.
                    dark : secondary 10.57  accent-hover 11.4
                    light: secondary  7.32  accent-hover  5.99
                */
                className={`relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${
                  active ? "text-[var(--accent-hover)]" : "text-[var(--text-secondary)]"
                }`}
              >
                {/* The active marker is a bar ABOVE the icon, flush to the top
                    border. A filled pill (the sidebar's active shape) does not
                    survive here: at ~72px wide it either clips the label or
                    forces the icon off-centre. */}
                {/* The marker is a FILL, not text: --accent is correct here.
                    WCAG's 3:1 non-text floor applies, and it clears that in
                    both themes (light 4.19, dark 9.69). It is deliberately a
                    different token from the label above, which is text and
                    owes 4.5. */}
                <span
                  aria-hidden
                  className={`absolute top-0 h-[2px] w-8 rounded-full transition-opacity ${
                    active ? "bg-[var(--accent)] opacity-100" : "opacity-0"
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
              moreOpen || !onATab ? "text-[var(--accent-hover)]" : "text-[var(--text-secondary)]"
            }`}
          >
            <span
              aria-hidden
              className={`absolute top-0 h-[2px] w-8 rounded-full transition-opacity ${
                moreOpen || !onATab ? "bg-[var(--accent)] opacity-100" : "opacity-0"
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
