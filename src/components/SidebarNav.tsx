"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/netflix", label: "Netflix Users" },
  { href: "/uploads", label: "Uploads" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-px">
      <div className="px-4 pb-1.5 pt-3 font-mono text-[9.5px] tracking-[0.12em] text-[var(--text-faint)]">
        PAGES
      </div>
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`px-4 py-1.5 text-[12.5px] transition-colors ${
              active
                ? "border-l-2 border-[var(--accent)] bg-[var(--surface-hover)] font-medium text-[var(--text-primary)]"
                : "border-l-2 border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
