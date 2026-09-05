"use client";

/**
 * Replay the onboarding tour: clears the tour-done flag so it plays on the next
 * page load.
 *
 * A MENU ITEM in `UserMenu`, beside Profile and above Log out. It used to be a
 * nav row at the foot of the sidebar; APPLE_REF §8 #30 moves both foot
 * actions into the user-chip menu, and a "replay the tour" control belongs
 * with the account it welcomes anyway. `tabIndex={-1}`: the menu is one tab
 * stop and moves focus between its items itself.
 */

import { useTranslations } from "next-intl";
import { IconReplay } from "./nav-icons";
import { menuItemClass } from "./ui/Menu";

export function TourReplayButton() {
  const t = useTranslations("common");
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={() => {
        localStorage.removeItem("hse_tour_done");
        window.location.reload();
      }}
      data-testid="tour-replay"
      className={menuItemClass}
    >
      <IconReplay className="flex-none text-[var(--text-secondary)]" />
      {t("replayTour")}
    </button>
  );
}
