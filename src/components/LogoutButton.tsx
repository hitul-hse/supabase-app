"use client";

/**
 * LogoutButton — sign out, in two shapes.
 *
 * `menuitem` (the default place, inside `UserMenu`): a 32 px menu row with the
 *   exit icon, the last item under a separator. It moved here from the foot
 *   of the sidebar (APPLE_REF §8 #30: "Avoid putting critical… actions at the
 *   bottom of a sidebar"), and it is under the identity it signs out.
 *
 * `row` (the default prop value, for /portal and /access-pending, which have
 *   no top bar): a bare nav-row-shaped button -- icon + "Log out" -- because a
 *   bordered button in a column of borderless rows read as a form control
 *   that had wandered into the navigation.
 *
 * The visible text IS the accessible name -- it changes to "Signing out…"
 * while the round trip runs, and a static aria-label would keep announcing
 * "Log out" over a button that is already doing it. The press
 * (`active:translate-y-px`) is CSS on the down event, so the row acknowledges
 * the click before the sign-out starts.
 *
 * SIGNING OUT IS A WAIT, AND IT LOOKS LIKE ONE (APPLE_REF §5.9 "loading";
 * §6.2 rows 1-2). Between the click and the redirect there is a real network
 * round trip -- `supabase.auth.signOut()` then a route push -- and until now
 * the only sign that anything was happening was the label changing inside a
 * menu row that had gone grey and lost focus. Three things changed:
 *
 *   1. A SPINNER, the same 14 px ring `Button busy` draws, in the icon's
 *      place. The icon does not disappear and the row does not change width:
 *      the spinner replaces the glyph in a slot of the same size, so the menu
 *      does not reflow under the cursor mid-sign-out.
 *   2. `aria-disabled`, NOT `disabled`. A `disabled` menu item is dropped from
 *      the menu's own arrow-key list (`[role="menuitem"]:not([disabled])`) and
 *      from the tab order, so the moment you pressed it focus fell to <body>
 *      and the arrow keys skipped the row that was mid-action. The guard
 *      against a double sign-out is the `pending` ref check inside the
 *      handler, where it belongs -- not in the tab order.
 *   3. `aria-live="polite"` on the label, so "Signing out…" is ANNOUNCED
 *      rather than merely rendered. A screen-reader user who has already
 *      moved focus on gets told the action started.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/utils/supabase/client";
import { IconLogout } from "./nav-icons";
import { menuItemClass } from "./ui/Menu";

/**
 * The glyph slot: the exit icon, or the same 14 px ring `Button busy` spins.
 * One fixed-size box either way, so the row cannot change width mid-action.
 */
function LogoutGlyph({ pending, className = "" }: { pending: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={`flex h-4 w-4 flex-none items-center justify-center ${className}`}>
      {pending ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
      ) : (
        <IconLogout />
      )}
    </span>
  );
}

export function LogoutButton({ variant = "row" }: { variant?: "row" | "menuitem" }) {
  const router = useRouter();
  const t = useTranslations("common");
  const [pending, setPending] = useState(false);
  // The double-click guard, in a ref rather than in state: two clicks inside
  // one React batch both read the same `pending` state and both fire.
  const running = useRef(false);

  const handleLogout = async () => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Logout error:", err);
    }
    router.push("/auth/login");
  };

  const label = pending ? t("signingOut") : t("logOut");
  // Announced, not merely rendered: the label IS the accessible name, and the
  // live region is what tells a reader who has moved on that it started.
  const text = (
    <span aria-live="polite" className="min-w-0 truncate">
      {label}
    </span>
  );

  if (variant === "menuitem") {
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={handleLogout}
        // aria-disabled, never `disabled`: see the header. The row stays in
        // the menu's arrow-key list and keeps focus while it works.
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        data-testid="logout-button"
        className={`${menuItemClass} active:translate-y-px aria-disabled:text-[var(--text-muted)]`}
      >
        <LogoutGlyph pending={pending} className="text-[var(--text-secondary)]" />
        {text}
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      type="button"
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      data-testid="logout-button"
      className="flex h-8 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-left t-callout text-[var(--text-secondary)] control-motion hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] aria-disabled:opacity-60"
    >
      <LogoutGlyph pending={pending} />
      {text}
    </button>
  );
}
