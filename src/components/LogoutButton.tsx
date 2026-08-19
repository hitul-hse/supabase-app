"use client";

/**
 * LogoutButton — sign out, in both sidebar shapes.
 *
 * Expanded: bordered button, icon + "Log out".
 * Rail:     a 40px square icon button with a hover/focus tooltip.
 *
 * Like SidebarNav, the shape comes from `group-data-[collapsed]/sidebar`
 * rather than a hook, because this renders inside an async server component
 * that cannot read the collapse context.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

function IconLogout() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
      aria-hidden
      focusable="false"
    >
      <path d="M6.25 13.5H3.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.75" />
      <path d="M10.25 10.75 13 8l-2.75-2.75" />
      <path d="M13 8H6.25" />
    </svg>
  );
}

export function LogoutButton() {
  const router = useRouter();
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
      aria-label="Log out"
      data-testid="logout-button"
      className="group/logout relative flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2 text-[12px] font-medium text-[var(--text-primary)] transition-colors duration-150 hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60 group-data-[collapsed=true]/sidebar:mx-auto group-data-[collapsed=true]/sidebar:h-10 group-data-[collapsed=true]/sidebar:w-10 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:border-transparent group-data-[collapsed=true]/sidebar:px-0 group-data-[collapsed=true]/sidebar:py-0"
    >
      <IconLogout />
      {/*
        Clipped rather than removed so the button keeps a text accessible name
        even in the rail; `aria-label` above is the belt to this braces.
      */}
      <span className="truncate transition-opacity duration-150 group-data-[collapsed=true]/sidebar:w-0 group-data-[collapsed=true]/sidebar:opacity-0">
        {pending ? "Signing out…" : "Log out"}
      </span>

      <span
        aria-hidden
        className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] font-normal text-[var(--text-primary)] opacity-0 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.5)] transition-opacity duration-150 group-hover/logout:opacity-100 group-focus-visible/logout:opacity-100 pointer-fine:group-data-[collapsed=true]/sidebar:block"
      >
        Log out
      </span>
    </button>
  );
}
