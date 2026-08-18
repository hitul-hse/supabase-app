import Link from "next/link";
import type { LivePerson } from "@/lib/queries/people-live";

/**
 * The org view, grouped by TrackingTime account role.
 *
 * WHY THIS IS NOT A REPORTING TREE
 * --------------------------------
 * It used to render `public.org_chart_nodes` — the same eight mockup people as
 * the old directory ("Anna Brandt" reporting to "S. Ott"), with invented
 * reporting lines. Worse than merely wrong: because both tabs are rendered from
 * one Server Component payload, those eight fake names shipped to the browser
 * on EVERY visit to /people, including while the real directory was on screen.
 * A live DOM probe found them sitting in the RSC script tag.
 *
 * TrackingTime holds no manager relationship — there is no `manager_id`, and
 * `hub_person_id` is null on all 49 members, so there is nothing to join to.
 * Drawing a hierarchy would therefore mean inventing one, which is exactly the
 * class of fiction this rewrite removes.
 *
 * So this groups the real roster by the one organisational fact TrackingTime
 * does record: each member's account role (ADMIN, MANAGER, PROJECT_MANAGER,
 * CO_WORKER). That is a true statement about permissions in TrackingTime, and
 * the header says so rather than implying it is a management chain.
 */

/** Display order — broadest authority first. Unknown roles sort last. */
const ROLE_ORDER = ["ADMIN", "MANAGER", "PROJECT_MANAGER", "CO_WORKER"];

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Account administrators",
  MANAGER: "Managers",
  PROJECT_MANAGER: "Project managers",
  CO_WORKER: "Co-workers",
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function OrgChartView({ people }: { people: LivePerson[] }) {
  const groups = new Map<string, LivePerson[]>();
  for (const p of people) {
    const key = p.accountRole ?? "UNKNOWN";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const ordered = [...groups.entries()].sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a[0]);
    const bi = ROLE_ORDER.indexOf(b[0]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  if (people.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-[12.5px] text-[var(--text-muted)]">
          No roster imported yet — run the TrackingTime sync.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <p className="max-w-[70ch] text-[12px] leading-relaxed text-[var(--text-secondary)]">
        Grouped by TrackingTime account role. TrackingTime records no reporting
        lines, so this is not a management hierarchy — it is who holds which
        permissions in the time-tracking account.
      </p>

      {ordered.map(([role, members]) => (
        <div key={role} className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2.5 border-b border-[var(--border)] pb-1.5">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              {ROLE_LABEL[role] ?? "Role not set"}
            </span>
            <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
              {members.length} {members.length === 1 ? "PERSON" : "PEOPLE"}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((m) => (
              <div
                key={m.memberId}
                className="flex items-center gap-3 border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] font-mono text-[11px] text-[var(--text-secondary)]"
                >
                  {initialsOf(m.name)}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                    {m.name}
                  </span>
                  <span className="truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                    {m.email ?? "no email on record"}
                  </span>
                </div>
                <Link
                  href={`/time/dashboard?members=${m.memberId}`}
                  className="ml-auto shrink-0 font-mono text-[10.5px] text-[var(--accent)] hover:underline"
                >
                  {/* n/a, never 0h — see people-live.ts on absent vs zero. */}
                  {m.totalHours > 0
                    ? `${m.totalHours.toLocaleString("de-DE", { maximumFractionDigits: 0 })} h`
                    : "n/a"}
                </Link>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
