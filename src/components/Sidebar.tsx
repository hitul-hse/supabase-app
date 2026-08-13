import Link from "next/link";
import Image from "next/image";
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
        <Image
          src="/hse-logo.png"
          alt="HSE"
          width={26}
          height={26}
          className="flex-none rounded-[var(--radius-sm)]"
        />
        <span className="flex flex-col leading-[1.15]">
          <span className="font-sans text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
            HSE HUB
          </span>
          <span className="font-mono text-[8.5px] tracking-[0.14em] text-[var(--text-faint)]">
            HEALTH &amp; SAFETY EXPERTS
          </span>
        </span>
      </Link>

      <SidebarNav />

      {email && (
        <div className="mt-auto flex flex-col gap-3 border-t border-[var(--border)] px-4 pt-4">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[10px] tracking-[0.02em] text-[var(--text-faint)]">
              LOGGED IN AS
            </p>
            <p className="truncate font-mono text-[11px] text-[var(--text-secondary)]">
              {email}
            </p>
          </div>
          <LogoutButton />
        </div>
      )}
    </div>
  );
}
