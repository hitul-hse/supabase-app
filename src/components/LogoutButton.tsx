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
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/utils/supabase/client";
import { IconLogout } from "./nav-icons";
import { menuItemClass } from "./ui/Menu";

export function LogoutButton({ variant = "row" }: { variant?: "row" | "menuitem" }) {
  const router = useRouter();
  const t = useTranslations("common");
  const [pending, setPending] = useState(false);

  const handleLogout = async () => {
    // Guard against a double click firing two signOut calls and two pushes.
    if (pending) return;
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

  if (variant === "menuitem") {
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={handleLogout}
        disabled={pending}
        data-testid="logout-button"
        className={menuItemClass}
      >
        <IconLogout className="flex-none text-[var(--text-secondary)]" />
        {label}
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      type="button"
      disabled={pending}
      data-testid="logout-button"
      className="flex h-8 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-left t-callout text-[var(--text-secondary)] transition-[color,background-color,transform] duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] disabled:opacity-60"
    >
      <IconLogout className="flex-none" />
      {label}
    </button>
  );
}
