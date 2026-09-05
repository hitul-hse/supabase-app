import React from "react";

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
   * Chrome pinned to the top-right: search, notifications, the user chip.
   * Supplied by the layout, not by pages -- it is identical everywhere, and a
   * per-page copy is how three slightly different top bars happen.
   */
  chrome?: React.ReactNode;
}

/**
 * PageHeader -- the top bar for every app page.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * The reference dashboard puts the page title top-LEFT and the account chrome
 * top-RIGHT, on one bar. Before this, the app had no top bar at all: identity
 * lived at the bottom of the sidebar, there was no search anywhere, and the
 * header spent its first line on an eyebrow.
 *
 * That mattered beyond looks. The user chip is the entry point to /profile, and
 * at the bottom of a 220px panel it is the least-looked-at pixel on screen --
 * and it vanishes entirely when the sidebar is collapsed to the rail.
 *
 * `meta` stays but drops below the title, where it reads as a qualifier on the
 * heading rather than competing with it.
 *
 * On mobile the title block goes full-width and actions wrap to a second row;
 * the chrome stays on the title's row, because a search button that jumps below
 * the fold is not a search button.
 */
export function PageHeader({ title, meta, actions, chrome }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--topbar)] px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="truncate t-title-2 sm:t-title text-[var(--text-primary)]">
            {title}
          </h1>
          {meta && (
            <span className="truncate t-label text-[var(--text-faint)]">
              {meta}
            </span>
          )}
        </div>

        {/*
          ONE instance, always -- rendered here inside the title row, `ml-auto`,
          so it stays pinned right at every width even when `actions` wraps to
          its own line below.

          Deliberately NOT a mobile copy plus a `sm:` desktop copy. Two
          CSS-hidden instances would both sit in the DOM carrying the same
          accessible names ("Search", "Notifications", the user's name), which is
          an ambiguous target for a screen reader and a strict-mode violation for
          any automation -- the identical bug already fixed on the sidebar
          collapse toggle, which shipped twice for exactly this reason.
        */}
        {chrome && (
          <div className="ml-auto flex flex-none items-center gap-2">{chrome}</div>
        )}
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
