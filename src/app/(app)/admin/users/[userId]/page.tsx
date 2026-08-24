import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { requirePermission, userHasPermission } from "@/utils/supabase/require-profile";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { PERMISSIONS } from "@/lib/permissions";
import { teamLabel } from "@/lib/teams";
import {
  getAdminProfileView,
  countNominalWeeks,
  ADMIN_ENTRY_LIMIT,
} from "@/lib/queries/profile-admin";
import { ProfileFieldsForm, WeeklyHoursForm } from "./ProfileEditForms";
import { EntryRow } from "./EntryRow";

/**
 * One person's record, as an administrator sees it.
 *
 * READ AND WRITE ARE SEPARATE KEYS. Reaching this page needs
 * admin:profiles:read; the two write keys only decide whether the CONTROLS are
 * rendered. That is presentation: every action in profile-actions.ts re-checks
 * its own permission against the database, because a Server Action is a public
 * HTTP endpoint and a hidden button is not a boundary. So an auditor can be
 * given read without write and see exactly what an editor sees, minus the forms.
 *
 * THE PERMISSION IS ASKED OF THE DATABASE, not compared against a role string.
 * Roles are data: /admin/roles can grant admin:profiles:write to a role that
 * does not exist yet, and `roleKey === "hr"` would silently ignore the grant.
 *
 * ABSENCE RENDERS AS ABSENCE. No linked TrackingTime member is "not linked", not
 * a member with 0 hours; no contracted hours is "n/a", not 40. A guessed zero on
 * this page becomes a utilisation figure somebody makes a decision on.
 */

// Async params: Next 16 passes route params as a Promise.
type Params = { params: Promise<{ userId: string }> };

const CARD =
  "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] card-elev";
const CAPTION = "font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]";

/** A value, or the honest absence marker. Never 0, never a guess. */
function orNa(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "n/a";
  return String(value);
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={CAPTION}>{label}</span>
      <span className="text-[13px] text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

export default async function AdminUserDetailPage({ params }: Params) {
  const { userId } = await params;

  // The gate. Uses the LIST path as the redirect target, so somebody who loses
  // access mid-session lands somewhere that explains itself.
  await requirePermission("/admin/users", PERMISSIONS.ADMIN_PROFILES_READ);

  const [canWriteProfile, canWriteEntries] = await Promise.all([
    userHasPermission(PERMISSIONS.ADMIN_PROFILES_WRITE),
    userHasPermission(PERMISSIONS.ADMIN_ENTRIES_WRITE),
  ]);

  const supabase = await createClient();

  // Whose page this is, and who is looking. Self-editing is refused by the
  // actions; knowing it here lets the page say so instead of offering forms that
  // cannot succeed.
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const isSelf = viewer?.id === userId;

  const [view, nominalCount] = await Promise.all([
    getAdminProfileView(supabase, userId),
    countNominalWeeks(supabase),
  ]);

  // No readable profile row. Deliberately indistinguishable from "no such user",
  // so a 404 cannot be used to enumerate accounts.
  if (!view) notFound();

  const { target, member, entries, hasMoreEntries } = view;

  /*
   * The email lives in auth.users, which the RLS-scoped client cannot reach. Read
   * through the service role when it is configured, and render "n/a" when it is
   * not -- the same treatment the list page gives it, rather than a blank that
   * looks like a person with no address.
   */
  let email: string | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(userId);
    email = data.user?.email ?? null;
  } catch {
    email = null;
  }

  const showProfileForm = canWriteProfile && !isSelf;
  const showEntryControls = canWriteEntries && !isSelf;

  return (
    <div className="flex flex-col" data-profile-admin="1">
      <PageHeader
        title={target.effectiveName}
        meta={`${target.roleDisplayName} · ${teamLabel(target.department)} · ${
          target.isActive ? "ACTIVE" : "INACTIVE"
        }`}
        actions={<ButtonLink href="/admin/users">Back to users</ButtonLink>}
      />

      <div className="flex flex-col gap-4 sm:gap-5 page-shell">
        {isSelf && (
          // Stated once, at the top, rather than as four identical refusals after
          // four failed submits. Self-service exists and exposes a deliberately
          // different field set.
          <div
            role="status"
            className={`${CARD} p-3 text-[12px] text-[var(--text-primary)]`}
          >
            This is your own record. Editing yourself through the admin path is
            refused by design — use your{" "}
            <a href="/profile" className="text-[var(--accent)] underline">
              profile page
            </a>{" "}
            instead.
          </div>
        )}

        {/* ---------------------------------------------------------- profile */}
        <section className={`${CARD} p-4 sm:p-5`}>
          <h2 className="mb-4 text-[13px] font-semibold text-[var(--text-primary)]">
            Hub profile
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Display name" value={orNa(target.displayName)} />
            <Fact label="Email" value={orNa(email)} />
            <Fact label="HR record" value={orNa(target.personName)} />
            <Fact label="Team" value={teamLabel(target.department)} />
            <Fact label="Role" value={target.roleDisplayName} />
            <Fact
              label="Status"
              value={
                <span
                  className={
                    target.isActive ? "text-[var(--good)]" : "text-[var(--text-muted)]"
                  }
                >
                  {target.isActive ? "Active" : "Inactive"}
                </span>
              }
            />
            <Fact
              label="Provisioned"
              value={new Date(target.createdAt).toLocaleDateString("de-DE")}
            />
            <Fact label="Person id" value={orNa(target.personId)} />
          </div>

          {showProfileForm && (
            <div className="mt-5 border-t border-[var(--divider)] pt-4">
              <h3 className={`${CAPTION} mb-3`}>Edit profile</h3>
              <ProfileFieldsForm target={target} />
            </div>
          )}
          {!canWriteProfile && (
            <p className="mt-4 text-[11px] text-[var(--text-faint)]">
              You can view this record but not change it (admin:profiles:write is
              not granted to your role).
            </p>
          )}
        </section>

        {/* ------------------------------------------------ tracking t member */}
        <section className={`${CARD} p-4 sm:p-5`}>
          <h2 className="mb-4 text-[13px] font-semibold text-[var(--text-primary)]">
            Time Tracking member
          </h2>

          {member ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Fact label="Member id" value={member.id} />
                <Fact label="Display name" value={orNa(member.displayName)} />
                <Fact label="Email" value={orNa(member.email)} />
                <Fact
                  label="Contracted week"
                  value={
                    member.weeklyHours === null ? (
                      "n/a"
                    ) : (
                      <>
                        {member.weeklyHours}h
                        {member.isNominalWeek && (
                          <span className="ml-1.5 font-mono text-[9px] tracking-[0.1em] text-[var(--warning)]">
                            NOMINAL
                          </span>
                        )}
                      </>
                    )
                  }
                />
                <Fact label="Job title" value={orNa(member.jobTitle)} />
                <Fact label="Time team" value={orNa(member.team)} />
                <Fact
                  label="Archived"
                  value={
                    member.isArchived ? (
                      <span className="text-[var(--warning)]">Yes</span>
                    ) : (
                      "No"
                    )
                  }
                />
              </div>

              {showProfileForm && (
                <div className="mt-5 border-t border-[var(--divider)] pt-4">
                  <WeeklyHoursForm member={member} nominalCount={nominalCount} />
                </div>
              )}
            </>
          ) : (
            // NOT LINKED is a state, not a zero. Saying what to do about it is the
            // difference between an empty panel and an actionable one.
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-[var(--text-primary)]">
                Not linked to a Time Tracking member.
              </p>
              <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                No row in the tracking roster matches this account by sign-in or by
                HR record, so there are no tracked hours and no contracted week to
                show — not zero of either. Linking happens on import, by matching
                email address.
              </p>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------- entries */}
        <section className={CARD}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
              Recent time entries
            </h2>
            <span className={CAPTION}>
              {member
                ? `${entries.length} SHOWN${
                    hasMoreEntries ? ` · NEWEST ${ADMIN_ENTRY_LIMIT} OF MORE` : ""
                  }`
                : "NO MEMBER LINKED"}
            </span>
          </div>

          {!member ? (
            <p className="px-4 py-8 text-center font-mono text-[11px] text-[var(--text-faint)]">
              NOT LINKED — NO ENTRIES TO SHOW
            </p>
          ) : entries.length === 0 ? (
            <p className="px-4 py-8 text-center font-mono text-[11px] text-[var(--text-faint)]">
              NO TIME LOGGED
            </p>
          ) : (
            entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} canWrite={showEntryControls} />
            ))
          )}

          {member && entries.length > 0 && !canWriteEntries && (
            <p className="px-4 py-3 text-[11px] text-[var(--text-faint)]">
              Entries are read-only for you (admin:entries:write is not granted to
              your role).
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
