"use client";
/**
 * SidebarNav — sidebar navigation with a shared-layout active indicator.
 *
 * Hover/press/focus states are pure CSS on purpose. Framer Motion writes
 * gesture styles inline, and its hover-end can be deferred (while pressed) or
 * dropped entirely if the pointerleave/pointerup never lands — which is exactly
 * what a click-then-navigate does. A dropped hover-end freezes the inline
 * background, and inline styles outrank the Tailwind classes, so the item stays
 * highlighted with no way for CSS to clear it. The browser cannot lose :hover.
 */
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";

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
      { href: "/people",     label: "People",          tourId: "tour-people"     },
      { href: "/projects",   label: "Projects",        tourId: "tour-projects"   },
      { href: "/timesheets", label: "Timesheets",      tourId: "tour-timesheets" },
      { href: "/leave",      label: "Leave & Time Off", tourId: "tour-leave"     },
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

interface SidebarNavProps {
  roleKey: string | null;
  /**
   * Only one mounted instance may own the data-tour attributes — OnboardingTour
   * resolves them with querySelector(), which returns the first match in DOM
   * order regardless of visibility. See Sidebar's `variant` prop.
   */
  withTourIds?: boolean;
}

export function SidebarNav({ roleKey, withTourIds = true }: SidebarNavProps) {
  const pathname = usePathname();

  // The desktop sidebar and the mobile drawer both mount a SidebarNav at the
  // same time. Framer keys shared-layout nodes in one global stack per
  // layoutId and promotes a single node to "lead", so a hardcoded id would let
  // the hidden drawer's bar win and strand the visible one on the old item.
  const activeBarId = `nav-active-bar-${useId()}`;

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
                  data-tour={withTourIds ? link.tourId : undefined}
                  data-active={active ? "true" : "false"}
                  aria-current={active ? "page" : undefined}
                  className="group relative block rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
                >
                  {/* Active left border. Lives on the untransformed Link so the
                      hover translate can't drag it off the sidebar edge, and is
                      rendered bare — wrapping a layoutId in AnimatePresence keeps
                      the outgoing node alive alongside the incoming one, which is
                      what left the bar sitting on the item you just left. */}
                  {active && (
                    <motion.span
                      layoutId={activeBarId}
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      className="absolute left-0 top-1/2 h-[70%] w-0.5 -translate-y-1/2 bg-[var(--accent)]"
                    />
                  )}

                  <div
                    className={`flex items-center justify-between rounded-sm px-4 py-1.5 text-[12.5px] transition-[background-color,color,transform] duration-150 ease-out group-hover:translate-x-[3px] group-hover:bg-[var(--surface-hover)] group-hover:text-[var(--text-primary)] group-focus-visible:bg-[var(--surface-hover)] group-active:scale-[0.98] motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 ${
                      active
                        ? "bg-[var(--surface-hover)] font-medium text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
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
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </motion.div>
      ))}
    </nav>
  );
}
