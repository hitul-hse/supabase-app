"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/netflix", label: "Netflix Users" },
  { href: "/uploads", label: "Uploads" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--page)]/85 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent)] text-xs font-bold text-[var(--accent-contrast)]">
            S
          </span>
          Supabase App
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  active
                    ? "bg-[var(--accent-wash)] text-[var(--accent)] font-medium"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
