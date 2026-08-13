"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavGroup {
  title: string;
  items: { href: string; label: string; badge?: string; badgeColor?: string }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "ANALYSE",
    items: [
      { href: "/", label: "Overview" },
      { href: "/team-lead", label: "Team Lead View", badge: "7", badgeColor: "var(--critical)" },
    ],
  },
  {
    title: "RECORDS",
    items: [
      { href: "/people", label: "People" },
      { href: "/projects", label: "Projects" },
      { href: "/timesheets", label: "Timesheets" },
    ],
  },
  {
    title: "STORAGE & LEGACY",
    items: [
      { href: "/uploads", label: "File Storage" },
      { href: "/netflix", label: "Sample DB" },
    ],
  },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-0.5">
          <div className="px-4 pb-1 font-mono text-[9.5px] tracking-[0.12em] text-[var(--text-faint)]">
            {group.title}
          </div>
          {group.items.map((link) => {
            const isRoot = link.href === "/";
            const active = isRoot ? pathname === "/" : pathname === link.href || pathname?.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center justify-between px-4 py-1.5 text-[12.5px] transition-colors ${
                  active
                    ? "border-l-2 border-[var(--accent)] bg-[var(--surface-hover)] font-medium text-[var(--text-primary)]"
                    : "border-l-2 border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span>{link.label}</span>
                {link.badge && (
                  <span
                    className="px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-black"
                    style={{ background: link.badgeColor || "var(--accent)" }}
                  >
                    {link.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
