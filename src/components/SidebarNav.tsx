"use client";
/**
 * SidebarNav — animated navigation with Framer Motion hover/active states
 * and data-tour attributes for the OnboardingTour spotlight.
 */
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavGroup {
  title: string;
  items: {
    href: string;
    label: string;
    badge?: string;
    badgeColor?: string;
    roles?: string[];
    tourId?: string;
  }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "ANALYSE",
    items: [
      { href: "/",          label: "Overview",       tourId: "tour-overview"  },
      { href: "/team-lead", label: "Team Lead View", tourId: "tour-teamlead",
        badge: "7", badgeColor: "var(--critical)", roles: ["exec", "dept_head"] },
    ],
  },
  {
    title: "RECORDS",
    items: [
      { href: "/people",     label: "People",     tourId: "tour-people"     },
      { href: "/projects",   label: "Projects",   tourId: "tour-projects"   },
      { href: "/timesheets", label: "Timesheets", tourId: "tour-timesheets" },
    ],
  },
  {
    title: "ADMIN",
    items: [
      { href: "/admin/users", label: "Users & Roles",    roles: ["exec", "dept_head"] },
      { href: "/admin/roles", label: "Role Permissions", roles: ["exec", "dept_head"] },
    ],
  },
];

export function SidebarNav({ roleKey }: { roleKey: string | null }) {
  const pathname = usePathname();

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.roles || (roleKey && item.roles.includes(roleKey))
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <nav className="flex flex-col gap-4">
      {groups.map((group, gi) => (
        <motion.div
          key={group.title}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: gi * 0.06 + 0.1, duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          className="flex flex-col gap-0.5"
        >
          <div className="px-4 pb-1 font-mono text-[9.5px] tracking-[0.12em] text-[var(--text-faint)]">
            {group.title}
          </div>

          {group.items.map((link, li) => {
            const isRoot = link.href === "/";
            const active = isRoot
              ? pathname === "/"
              : pathname === link.href || pathname?.startsWith(`${link.href}/`);

            return (
              <motion.div
                key={link.href}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: gi * 0.06 + li * 0.04 + 0.15, duration: 0.25 }}
              >
                <Link
                  href={link.href}
                  data-tour={link.tourId}
                  className="block"
                >
                  <motion.div
                    whileHover={{ x: 3, backgroundColor: "var(--surface-hover)" }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    className={`relative flex items-center justify-between px-4 py-1.5 text-[12.5px] transition-colors rounded-sm ${
                      active
                        ? "bg-[var(--surface-hover)] font-medium text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {/* Animated left border */}
                    <AnimatePresence>
                      {active && (
                        <motion.span
                          layoutId="nav-active-bar"
                          initial={{ scaleY: 0 }}
                          animate={{ scaleY: 1 }}
                          exit={{ scaleY: 0 }}
                          transition={{ type: "spring", stiffness: 500, damping: 40 }}
                          className="absolute left-0 top-0 h-full w-0.5 bg-[var(--accent)] origin-center"
                        />
                      )}
                    </AnimatePresence>

                    <span>{link.label}</span>

                    {link.badge && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", delay: 0.3 }}
                        className="px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-black"
                        style={{ background: link.badgeColor || "var(--accent)" }}
                      >
                        {link.badge}
                      </motion.span>
                    )}
                  </motion.div>
                </Link>
              </motion.div>
            );
          })}
        </motion.div>
      ))}
    </nav>
  );
}
