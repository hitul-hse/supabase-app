"use client";
/**
 * SidebarNav — the app's primary navigation, in two shapes.
 *
 * EXPANDED: icon + label + optional badge, grouped under section headings.
 * RAIL:     icon only, centred, label surfaced as a hover/focus tooltip.
 *
 * The shape is driven by `group-data-[collapsed=true]/sidebar` variants rather
 * than by React state. That matters: <Sidebar/> is an async SERVER component,
 * so nothing in this subtree can read the collapse context on the server, and
 * anything gated on a client hook would render the wrong shape until hydration.
 * CSS off a data attribute is correct on the very first byte of HTML.
 *
 * Labels are never removed from the DOM in rail mode -- they are clipped to a
 * zero-width box. Deleting them would leave links whose entire accessible name
 * is a decorative icon, i.e. unusable with a screen reader.
 */
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { IconDot, NAV_ICONS } from "./nav-icons";

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
      { href: "/dashboard/management", label: "Management", roles: ["exec"] },
      { href: "/team-lead", label: "Team Lead View", tourId: "tour-teamlead",
        badge: "7", badgeColor: "var(--critical)", roles: ["exec", "dept_head"] },
    ],
  },
  {
    title: "RECORDS",
    items: [
      // First in RECORDS, and deliberately above People/Projects: for a
      // consultant this is the only page that is about THEM. The portfolio
      // pages answer "how is the company doing"; this one answers "what is
      // mine", which is the question somebody has when they open the Hub at
      // 8am. No `roles` gate -- everyone has a book of work, and an account
      // with no linked person row is told so by the page itself rather than
      // being denied a nav entry it cannot see the reason for.
      { href: "/my-work",    label: "My Work",         tourId: "tour-my-work"    },
      { href: "/people",     label: "People",          tourId: "tour-people"     },
      { href: "/projects",   label: "Projects",        tourId: "tour-projects"   },
      { href: "/timesheets", label: "Timesheets",      tourId: "tour-timesheets" },
      // The TrackingTime module, deliberately alongside Timesheets rather than
      // replacing it: /timesheets is the Hub's editable weekly grid in hours,
      // this is the imported TrackingTime data in seconds.
      //
      // Points at /time/dashboard, not /time. The dashboard is the module's
      // primary surface — filtered organisation-wide reporting — while /time is
      // the personal tracker reached from it. Note the active-state check below
      // matches `startsWith(href)`, so this entry correctly stays highlighted on
      // the nested dashboard route.
      { href: "/time/dashboard", label: "TrackingTime Dashboard"                 },
      // Factorial HR presence vs TrackingTime logged hours. Exec/HR only, and the
      // page itself enforces HR_CONTRACT_READ -- the Factorial figures come from a
      // server API key that RLS never mediates, so hiding this entry is a
      // convenience, not the access control.
      { href: "/operations-analytics", label: "Operations Analytics", roles: ["exec", "hr"] },
      { href: "/leave",      label: "Leave & Time Off", tourId: "tour-leave"     },
    ],
  },
  {
    title: "ADMIN",
    items: [
      { href: "/customer-master/import-review", label: "Customer Master", roles: ["exec"] },
      // Beside Customer Master because both answer the same question: can the
      // customer record be trusted. Exec-only -- these checks compare the WHOLE
      // order book against itself, so a department-scoped reader would get a
      // partial report that looks complete, which is worse than no report.
      { href: "/data-hygiene", label: "Data Hygiene", roles: ["exec"] },
      { href: "/admin/users", label: "Users & Roles",    roles: ["exec", "dept_head"] },
      { href: "/admin/roles", label: "Role Permissions", roles: ["exec", "dept_head"] },
      // Budget alerts. Deliberately in ADMIN rather than beside Projects: these
      // are commercial exceptions somebody must act on, not a project record.
      { href: "/admin/alerts", label: "Budget Alerts",    roles: ["exec", "dept_head", "project_manager", "hr"] },
    ],
  },
];

// Sidebar labels stay English literals in NAV_GROUPS (greppable by what the
// default locale shows); these maps carry them to messages/{en,de}.json keys.
// A label missing here falls back to its English literal rather than crashing.
const NAV_LABEL_KEYS: Record<string, string> = {"Overview": "overview", "Management": "management", "Team Lead View": "teamLead", "My Work": "myWork", "People": "people", "Projects": "projects", "Timesheets": "timesheets", "TrackingTime Dashboard": "timeDashboard", "Operations Analytics": "operationsAnalytics", "Leave & Time Off": "leave", "Customer Master": "customerMaster", "Data Hygiene": "dataHygiene", "Users & Roles": "usersRoles", "Role Permissions": "rolePermissions", "Budget Alerts": "budgetAlerts"};
const NAV_TITLE_KEYS: Record<string, string> = {"ANALYSE": "sections.analyse", "RECORDS": "sections.records", "ADMIN": "sections.admin"};

export function SidebarNav({ roleKey }: { roleKey: string | null }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const navLabel = (label: string) =>
    NAV_LABEL_KEYS[label] ? t(NAV_LABEL_KEYS[label]) : label;
  const navTitle = (title: string) =>
    NAV_TITLE_KEYS[title] ? t(NAV_TITLE_KEYS[title]) : title;

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.roles || (roleKey && item.roles.includes(roleKey))
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {groups.map((group, gi) => (
        <motion.div
          key={group.title}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: gi * 0.06 + 0.1, duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="flex flex-col gap-0.5"
        >
          {/*
            In rail mode the heading collapses to a hairline rule. A group needs
            SOME separator or the nine icons read as one undifferentiated column,
            but the word itself will not fit in 64px and truncating "ANALYSE" to
            "AN…" is worse than a line.
          */}
          <div
            aria-hidden
            className="mx-3 mb-1 hidden h-px bg-[var(--border)] group-data-[collapsed=true]/sidebar:block"
          />
          <div className="px-4 pb-1 font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)] group-data-[collapsed=true]/sidebar:hidden">
            {navTitle(group.title)}
          </div>

          {group.items.map((link, li) => {
            const isRoot = link.href === "/";
            const active = isRoot
              ? pathname === "/"
              : pathname === link.href || pathname?.startsWith(`${link.href}/`);
            const Icon = NAV_ICONS[link.href] ?? IconDot;

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
                  data-testid={`nav-link-${link.href}`}
                  aria-current={active ? "page" : undefined}
                  /*
                    `group/item` scopes the tooltip's hover and focus-within to
                    this one row. `relative` anchors the tooltip. Both live on
                    the anchor, not the inner div, so keyboard focus reveals the
                    tooltip too -- a mouse-only tooltip is a rail with no labels
                    for anyone tabbing through it.
                  */
                  className="group/item relative block rounded-[var(--radius-sm)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
                >
                  <div
                    /*
                      `gap-0` in the rail is load-bearing, not tidying.

                      The label is clipped to width 0 rather than removed, so it
                      is still a flex item -- and `justify-center` centres the
                      icon PLUS that zero-width span PLUS the 10px gap between
                      them. The result is every icon sitting 5px left of centre:
                      visible as a wonky column, and exactly what the visual
                      probe measured (icon at 27px, content centre at 32px).
                    */
                    /*
                      The active row is a FILLED PILL, not a tinted rectangle
                      with a 2px accent bar.

                      Two reasons the bar went. It was a coloured border-left on
                      a list item, which the craft floor rejects as a default:
                      the marker was doing the job the fill should do, so the
                      row read as "highlighted" rather than "selected". And in
                      the rail it had to shrink to a stub floating 2px from a
                      centred icon, which reads as a rendering artifact rather
                      than as state.

                      A filled pill states the same thing once, at both widths,
                      with nothing to special-case.
                    */
                    className={`relative flex items-center gap-2.5 overflow-hidden rounded-[var(--radius)] px-3 py-1.5 text-[12px] transition-colors duration-150 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:gap-0 group-data-[collapsed=true]/sidebar:px-0 group-data-[collapsed=true]/sidebar:py-2.5 ${
                      active
                        ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {/*
                      `text-current` on BOTH states now. The icon used to be
                      forced to --accent when active, which against the filled
                      pill would put the accent on top of itself -- 1.06:1,
                      effectively invisible. It inherits --accent-contrast from
                      the pill instead.
                    */}
                    <Icon className="flex-none transition-colors text-current" />

                    {/*
                      Clipped, not removed. `w-0 opacity-0` keeps the text in the
                      accessible name while taking no space; the parent's
                      `overflow-hidden` stops it painting over the rail during
                      the width animation.
                    */}
                    <span
                      data-testid="nav-label"
                      className="min-w-0 flex-1 truncate transition-[opacity] duration-150 group-data-[collapsed=true]/sidebar:w-0 group-data-[collapsed=true]/sidebar:flex-none group-data-[collapsed=true]/sidebar:opacity-0"
                    >
                      {navLabel(link.label)}
                    </span>

                    {/*
                      On an ACTIVE row the badge sits on the filled accent pill,
                      so it cannot use an accent fill of its own -- the default
                      badgeColor is --accent, which would be accent-on-accent
                      (1.0:1, invisible). Active rows get the pill's own
                      foreground as a solid chip instead.
                    */}
                    {link.badge && (
                      <span
                        className={`flex-none rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold group-data-[collapsed=true]/sidebar:hidden ${
                          active ? "text-[var(--accent)]" : "text-black"
                        }`}
                        style={{
                          background: active
                            ? "var(--accent-contrast)"
                            : link.badgeColor || "var(--accent)",
                        }}
                      >
                        {link.badge}
                      </span>
                    )}

                    {/*
                      Badge in rail mode: a dot in the icon's top-right corner.
                      The count will not fit, but losing the signal entirely
                      would hide the one nav item asking for attention.
                    */}
                    {link.badge && (
                      <span
                        aria-hidden
                        className="absolute right-3.5 top-2 hidden h-1.5 w-1.5 rounded-full ring-2 ring-[var(--sidebar)] group-data-[collapsed=true]/sidebar:block"
                        style={{ background: link.badgeColor || "var(--accent)" }}
                      />
                    )}
                  </div>

                  {/*
                    Rail tooltip. `aria-hidden` because the clipped label above
                    already names the link -- announcing both would read the item
                    twice. Rendered only when collapsed, and never on touch
                    (`pointer-fine`), where there is no hover to trigger it.
                  */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] opacity-0 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.5)] transition-opacity duration-150 group-hover/item:opacity-100 group-focus-visible/item:opacity-100 pointer-fine:group-data-[collapsed=true]/sidebar:block"
                  >
                    {navLabel(link.label)}
                    {link.badge ? (
                      <span className="ml-1.5 font-mono text-[10px] text-[var(--text-faint)]">
                        {link.badge}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </motion.div>
            );
          })}
        </motion.div>
      ))}
    </nav>
  );
}
