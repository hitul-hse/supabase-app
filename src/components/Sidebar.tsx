import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { SidebarNav } from "./SidebarNav";
import { LogoutButton } from "./LogoutButton";

async function getUserEmail() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export async function Sidebar() {
  const email = await getUserEmail();

  return (
    <div className="flex w-[var(--sidebar-width)] flex-none flex-col gap-5 bg-[var(--sidebar)] py-4">
      <Link href="/" className="flex items-center gap-2.5 px-4">
        <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] font-mono text-xs font-bold text-[var(--accent-contrast)]">
          S
        </span>
        <span className="flex flex-col leading-[1.15]">
          <span className="font-sans text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
            SUPABASE APP
          </span>
          <span className="font-mono text-[8.5px] tracking-[0.14em] text-[var(--text-faint)]">
            NEXT.JS STARTER
          </span>
        </span>
      </Link>

      <SidebarNav />

      <div className="mt-auto flex flex-col gap-3 border-t border-[var(--border)] px-4 pt-4">
        {email && (
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[10px] tracking-[0.02em] text-[var(--text-faint)]">
              LOGGED IN AS
            </p>
            <p className="truncate font-mono text-[11px] text-[var(--text-secondary)]">
              {email}
            </p>
          </div>
        )}
        <LogoutButton />
      </div>
    </div>
  );
}
