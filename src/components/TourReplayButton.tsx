"use client";

/**
 * Replay the onboarding tour: clears the tour-done flag so it plays on the next
 * page load.
 *
 * A NAV ROW beside "Log out", in the same geometry as the links above -- it
 * used to be a 10px mono caption ("REPLAY TOUR") floating under the bordered
 * logout button, a third dialect in a column that already had two. In the rail
 * it keeps its place as an icon with the standard tooltip rather than
 * disappearing: the footer has room for two icons, and a control that vanishes
 * when the panel narrows is one a reader stops looking for.
 */

import { useTranslations } from "next-intl";
import { IconReplay } from "./nav-icons";

export function TourReplayButton() {
  const t = useTranslations("common");
  return (
    <button
      onClick={() => {
        localStorage.removeItem("hse_tour_done");
        window.location.reload();
      }}
      type="button"
      aria-label={t("replayTour")}
      className="group/replay relative block w-full rounded-[var(--radius-sm)] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
    >
      <div className="flex items-center gap-2.5 overflow-hidden rounded-[var(--radius)] px-3 py-1.5 t-callout text-[var(--text-secondary)] transition-[color,background-color,transform] duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:translate-y-px group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:gap-0 group-data-[collapsed=true]/sidebar:px-0 group-data-[collapsed=true]/sidebar:py-2.5">
        <IconReplay className="flex-none" />
        <span className="min-w-0 flex-1 truncate transition-[opacity] duration-200 group-data-[collapsed=true]/sidebar:w-0 group-data-[collapsed=true]/sidebar:flex-none group-data-[collapsed=true]/sidebar:opacity-0">
          {t("replayTour")}
        </span>
      </div>

      <span
        aria-hidden
        className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 t-callout text-[var(--text-primary)] opacity-0 card-elev-raised transition-opacity duration-150 group-hover/replay:opacity-100 group-focus-visible/replay:opacity-100 pointer-fine:group-data-[collapsed=true]/sidebar:block"
      >
        {t("replayTour")}
      </span>
    </button>
  );
}
