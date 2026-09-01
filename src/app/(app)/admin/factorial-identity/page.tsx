import { PageHeader } from "@/components/PageHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { requirePermission, userHasPermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { createAdminClient } from "@/utils/supabase/admin";
import { ReviewRow, type PersonOption, type ReviewRowData } from "./ReviewRow";

/**
 * The other half of `npm run sync:factorial-identity`.
 *
 * The sync classifies every Factorial employee and refuses -- by database
 * constraint, not etiquette -- to make the calls that need a human: shared
 * mailboxes, ambiguous emails, colleagues whose address matches nothing.
 * Those land here as open rows, and every button on this page signs the
 * decision with the reviewer's id, which is exactly what the schema demands
 * before it will accept a terminal status.
 *
 * Known residents of this queue, per docs/next-steps-2026-08-26.md: 25
 * archived leavers, a misspelled-domain contractor with 139.8 billable hours
 * (Stefan), and info@/jobs@ -- addresses that are not people at all.
 */

const OPEN = ["unmatched", "bridged_unlinked", "ambiguous"];

export default async function FactorialIdentityPage() {
  await requirePermission("/admin/factorial-identity", PERMISSIONS.ADMIN_USERS_READ);
  const canDecide = await userHasPermission(PERMISSIONS.ADMIN_USERS_WRITE);

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const crm = (admin as any).schema("crm");

  let open: ReviewRowData[] = [];
  let decided: ReviewRowData[] = [];
  let people: PersonOption[] = [];
  let loadError: string | null = null;

  try {
    const [openRes, decidedRes, peopleRes] = await Promise.all([
      crm.from("factorial_identity_review")
        .select("id, factorial_login_email, factorial_full_name, factorial_active, candidate_person_id, candidate_count, status, status_reason, last_seen_at")
        .in("status", OPEN)
        .order("last_seen_at", { ascending: false }),
      crm.from("factorial_identity_review")
        .select("id, factorial_login_email, factorial_full_name, factorial_active, candidate_person_id, candidate_count, status, status_reason, last_seen_at")
        .not("status", "in", `(${OPEN.join(",")})`)
        .order("last_seen_at", { ascending: false })
        .limit(50),
      admin.from("people").select("id, name").order("name"),
    ]);
    if (openRes.error) throw openRes.error;
    if (decidedRes.error) throw decidedRes.error;
    if (peopleRes.error) throw peopleRes.error;
    open = openRes.data ?? [];
    decided = decidedRes.data ?? [];
    people = (peopleRes.data ?? []) as PersonOption[];
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Factorial identity queue"
        meta="Who is who: connect Factorial employees to hub people. The sync fills this queue; only a named human may empty it."
      />

      {loadError && (
        <Card>
          <CardHeader title="Queue unavailable" />
          <p className="px-4 pb-4 text-sm text-[var(--muted)]">
            {loadError}. If this mentions a missing relation, migration
            20260826140000 has not been applied to this database yet — apply it,
            then run <code>npm run sync:factorial-identity</code>.
          </p>
        </Card>
      )}

      {!loadError && (
        <>
          <Card>
            <CardHeader
              title={`Open — ${open.length}`}
              qualifier={open.length === 0
                ? "Nothing waiting. Either the sync has not run yet, or every identity is decided."
                : "Each row needs one of three calls: it is this person; it is not a person; it is not our employee."}
            />
            <div className="space-y-3 px-4 pb-4">
              {open.map((row) => (
                canDecide
                  ? <ReviewRow key={row.id} row={row} people={people} />
                  : (
                    <div key={row.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
                      <span className="font-medium">{row.factorial_full_name ?? "(no name)"}</span>
                      <span className="ml-2 text-sm text-[var(--muted)]">{row.factorial_login_email}</span>
                      <p className="mt-1 text-sm text-[var(--muted)]">{row.status_reason}</p>
                    </div>
                  )
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title={`Decided — ${decided.length}${decided.length === 50 ? "+" : ""}`}
              qualifier="Auto-resolved by exact email, or signed off by a reviewer."
            />
            <div className="px-4 pb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="py-2 pr-4">Factorial</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {decided.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--border)]">
                      <td className="py-2 pr-4">
                        {row.factorial_full_name ?? "—"}
                        <span className="ml-2 text-[var(--muted)]">{row.factorial_login_email}</span>
                      </td>
                      <td className="py-2 pr-4">{row.status}</td>
                      <td className="py-2 text-[var(--muted)]">{row.status_reason}</td>
                    </tr>
                  ))}
                  {decided.length === 0 && (
                    <tr><td colSpan={3} className="py-3 text-[var(--muted)]">No decisions yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
