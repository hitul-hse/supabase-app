"use client";

/**
 * LogoutButton — sign out, in both sidebar shapes.
 *
 * Expanded: a NAV ROW -- icon + "Log out" in exactly the geometry of the links
 *           above it, because it sits in the same column and a bordered button
 *           at the bottom of a list of borderless rows read as a form control
 *           that had wandered into the navigation.
 * Rail:     icon only, centred, with the same hover/focus tooltip the nav rows
 *           surface their labels in.
 *
 * Like SidebarNav, the shape comes from `group-data-[collapsed]/sidebar`
 * rather than a hook, because this renders inside an async server component
 * that cannot read the collapse context.
 *
 * The press (`active:translate-y-px`) is CSS on the down event, so the row
 * acknowledges the click before the sign-out round trip starts.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/utils/supabase/client";
import { IconLogout } from "./nav-icons";

export function LogoutButton() {
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

  return (
    <button
      onClick={handleLogout}
      type="button"
      disabled={pending}
      aria-label={t("logOut")}
      data-testid="logout-button"
      className="group/logout relative block w-full rounded-[var(--radius-sm)] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] disabled:opacity-60"
    >
      {/* The same inner row as a nav link: `gap-0` and `px-0` in the rail so
          the zero-width label does not push the icon off centre. */}
      <div className="flex items-center gap-2.5 overflow-hidden rounded-[var(--radius)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-[color,background-color,transform] duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:translate-y-px group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:gap-0 group-data-[collapsed=true]/sidebar:px-0 group-data-[collapsed=true]/sidebar:py-2.5">
        <IconLogout className="flex-none" />
        {/*
          Clipped rather than removed so the button keeps a text accessible name
          even in the rail; `aria-label` above is the belt to this braces. 200ms
          so the label and the rail width settle together.
        */}
        <span className="min-w-0 flex-1 truncate transition-[opacity] duration-200 group-data-[collapsed=true]/sidebar:w-0 group-data-[collapsed=true]/sidebar:flex-none group-data-[collapsed=true]/sidebar:opacity-0">
          {pending ? t("signingOut") : t("logOut")}
        </span>
      </div>

      <span
        aria-hidden
        className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] font-normal text-[var(--text-primary)] opacity-0 card-elev-raised transition-opacity duration-150 group-hover/logout:opacity-100 group-focus-visible/logout:opacity-100 pointer-fine:group-data-[collapsed=true]/sidebar:block"
      >
        {t("logOut")}
      </span>
    </button>
  );
}
