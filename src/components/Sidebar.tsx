import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getCurrentProfile } from "@/lib/queries/auth";
import { SidebarNav } from "./SidebarNav";
import { LogoutButton } from "./LogoutButton";
import { TourReplayButton } from "./TourReplayButton";
import { SidebarToggle } from "./SidebarToggle";

async function getUserInfo() {
  const envConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!envConfigured) {
    return { status: "not configured" as const, email: null, roleKey: null, roleDisplayName: null };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    const profile = user ? await getCurrentProfile(supabase, user.id, user.email ?? null) : null;

    return {
      status: error ? ("error" as const) : ("connected" as const),
      email: user?.email ?? null,
      roleKey: profile?.roleKey ?? null,
      roleDisplayName: profile?.roleDisplayName ?? null,
    };
  } catch {
    return { status: "error" as const, email: null, roleKey: null, roleDisplayName: null };
  }
}

/**
 * @param showCollapseControl
 *   Whether to render the hide-sidebar button. Defaults to false because this
 *   component is mounted TWICE -- once in the desktop shell and once inside the
 *   mobile drawer -- and two buttons carrying the same test id and aria-label
 *   is an ambiguous accessible name for screen reader users, plus a strict-mode
 *   violation for any automation. Only the desktop instance opts in; the drawer
 *   already has its own close affordance.
 */
export async function Sidebar({
  showCollapseControl = false,
}: { showCollapseControl?: boolean } = {}) {
  const { status, email, roleKey, roleDisplayName } = await getUserInfo();
  const dotColor =
    status === "connected" ? "var(--good)" : status === "error" ? "var(--critical)" : "var(--warning)";
  const statusLabel =
    status === "connected" ? "Supabase Live" : status === "error" ? "Supabase Error" : "Not Configured";

  return (
    <aside className="flex h-full w-[220px] flex-none flex-col gap-4 border-r border-[var(--border)] bg-[var(--sidebar)] py-4">
      {/* Brand header, with the collapse control opposite it */}
      <div className="flex items-center gap-2 px-4">
        <Link href="/" className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="relative h-[26px] w-[26px] flex-none overflow-hidden rounded-[var(--radius-sm)]">
            <Image
              src="/hse-logo.png"
              alt="HSE Logo"
              width={26}
              height={26}
              className="h-full w-full object-contain"
              priority
            />
          </div>
          <div className="flex min-w-0 flex-col leading-[1.15]">
            <span className="font-sans text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
              HSE HUB
            </span>
            <span className="truncate font-mono text-[8px] tracking-[0.14em] text-[var(--text-faint)]">
              HEALTH &amp; SAFETY EXPERTS
            </span>
          </div>
        </Link>
        {/*
          Sits beside the brand link, not inside it -- nesting a button in an
          anchor is invalid HTML and the click would navigate as well as toggle.
        */}
        {showCollapseControl && <SidebarToggle variant="inside" />}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto">
        <SidebarNav roleKey={roleKey} />
      </div>

      {/* User profile & Supabase status footer */}
      <div className="mt-auto flex flex-col gap-2.5 border-t border-[var(--border)] px-4 pt-3">
        <div className="flex items-center gap-2.5">
          <div
            className="h-6 w-6 flex-none rounded-full"
            style={{
              background:
                "repeating-linear-gradient(45deg, #4a525d, #4a525d 3px, #3c434e 3px, #3c434e 6px)",
            }}
          />
          <div className="flex flex-col min-w-0">
            <span className="text-[12px] font-medium text-[var(--text-primary)] truncate">
              {email ?? "Not signed in"}
            </span>
            <span className="font-mono text-[9.5px] text-[var(--text-faint)]">
              {roleDisplayName ? roleDisplayName.toUpperCase() : email ? "PENDING ACCESS" : "—"}
            </span>
          </div>
        </div>

        {email && <LogoutButton />}
        {email && <TourReplayButton />}

        <div className="flex items-center gap-2 pt-1">
          <span
            aria-hidden
            className="h-1.5 w-1.5 flex-none rounded-full"
            style={{ background: dotColor }}
          />
          <span className="font-mono text-[9.5px] tracking-[0.02em] text-[var(--text-faint)]">
            {statusLabel.toUpperCase()}
          </span>
        </div>
      </div>
    </aside>
  );
}
