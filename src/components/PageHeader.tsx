import React from "react";
import { TopBarChromeSlot } from "./TopBarChromeSlot";

interface PageHeaderProps {
  title: string;
  meta?: string;
  /**
   * @deprecated Accepted so the ~10 existing call sites keep compiling, but
   * NEVER rendered.
   *
   * This was an eyebrow -- "HSE HUB / ANALYSE" above "Business overview" -- and
   * the craft floor bans it outright rather than as a default: the heading
   * carries its own weight, and the label above it repeated the sidebar (which
   * already shows both the product and the active section, permanently) while
   * pushing the actual title down the page.
   *
   * Kept as an accepted-and-ignored prop rather than removed, deliberately.
   * Deleting it would mean editing every page in one commit, including the
   * module pages another agent has uncommitted work in -- and a shared-component
   * change should not force a merge conflict in eight files. New pages should
   * simply not pass it.
   */
  category?: string;
  actions?: React.ReactNode;
  /**
   * Chrome pinned to the top-right: locale, theme, search, the user menu.
   *
   * Supplied by the LAYOUT through `TopBarChromeProvider`, and read back here
   * through `TopBarChromeSlot` by default -- so no page passes it, and every
   * page gets it. Pass `null` to opt a page out. (It was a per-page prop once;
   * one page passed it, and the /profile entry point silently vanished from
   * every other page.)
   */
  chrome?: React.ReactNode;
}

/**
 * PageHeader -- the top bar for every app page. APPLE_REF §5.1 "top bar",
 * §3.2 "Top bar (PageHeader)".
 *
 * WHAT IT IS
 * ----------
 * The macOS window toolbar, in flow: leading title (`t-title` 22/26, 17/22
 * below `sm`) with the `meta` qualifier on the same baseline at `sm` and up --
 * the way `CardHeader` sets a title beside its qualifier, and the way Mail
 * puts "Inbox — 3 unread" beside the window title. Trailing, `ml-auto`: the
 * account chrome. `actions` wrap onto their own row below. Opaque
 * `--topbar` (M3 desktop chrome, §4.2: nothing scrolls beneath it), `border-b`,
 * not sticky. 12 px above and below (§3.2): the 26 px title line alone would
 * make that 50; the 32 px `md` controls in the trailing group make the bar
 * 56 + hairline, measured 57 -- Apple's own toolbar proportion of 12 pt of air
 * around a control. On a phone the controls grow to 44 and the bar to 69.
 *
 * Below `sm` the meta drops under the title and the chrome stays on the
 * title's row, because a search button that jumps below the fold is not a
 * search button.
 *
 * ONE chrome instance, always -- rendered here inside the title row so it
 * stays pinned right at every width even when `actions` wraps to its own
 * line. Deliberately NOT a mobile copy plus a `sm:` desktop copy: two
 * CSS-hidden instances would both sit in the DOM carrying the same accessible
 * names ("Search", the user's name), which is an ambiguous target for a
 * screen reader and a strict-mode violation for any automation -- the
 * identical bug already fixed on the sidebar collapse toggle.
 */
export function PageHeader({
  title,
  meta,
  actions,
  chrome = <TopBarChromeSlot />,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--topbar)] px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2.5">
          <h1 className="min-w-0 truncate t-title-2 sm:t-title text-[var(--text-primary)]">
            {title}
          </h1>
          {/* Gives way three times faster than the title when the row is
              short: the qualifier truncates long before the heading does. */}
          {meta && (
            <span className="min-w-0 shrink-[3] truncate t-label text-[var(--text-faint)]">
              {meta}
            </span>
          )}
        </div>

        {chrome && (
          <div className="ml-auto flex flex-none items-center gap-2">{chrome}</div>
        )}
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
