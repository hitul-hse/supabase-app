import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { SidebarNav } from "./SidebarNav";

async function getConnectionStatus() {
  const envConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!envConfigured) return "not configured" as const;

  const supabase = await createClient();
  const { error } = await supabase.auth.getSession();
  return error ? ("error" as const) : ("connected" as const);
}

export async function Sidebar() {
  const status = await getConnectionStatus();
  const dotColor =
    status === "connected" ? "var(--good)" : status === "error" ? "var(--critical)" : "var(--warning)";
  const statusLabel =
    status === "connected" ? "Supabase connected" : status === "error" ? "Supabase unreachable" : "Not configured";

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

      <div className="mt-auto flex items-center gap-2 border-t border-[var(--border)] px-4 pt-3">
        <span
          aria-hidden
          className="h-[7px] w-[7px] flex-none rounded-full"
          style={{ background: dotColor }}
        />
        <span className="font-mono text-[10px] tracking-[0.02em] text-[var(--text-faint)]">
          {statusLabel.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
