import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireProfile } from "@/utils/supabase/require-profile";
import { createAdminClient } from "@/utils/supabase/admin";
import { listUserProfiles, getRoles } from "@/lib/queries/auth";
import { InviteUserForm } from "./InviteUserForm";
import { UserRow } from "./UserRow";

export type AppRoleRow = { role_key: string; display_name: string; seniority: number };
export type PersonOption = { id: string; name: string };

export default async function AdminUsersPage() {
  const profile = await requireProfile("/admin/users", ["exec", "dept_head"]);
  const canEdit = profile.roleKey === "exec";
  const supabase = await createClient();

  const [profiles, roles, { data: people }] = await Promise.all([
    listUserProfiles(supabase),
    getRoles(supabase),
    supabase.from("people").select("id, name").order("id"),
  ]);

  let emailByUserId = new Map<string, string>();
  let adminUnavailable: string | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.listUsers();
    emailByUserId = new Map(data.users.map((u) => [u.id, u.email ?? ""]));
  } catch (err) {
    adminUnavailable = err instanceof Error ? err.message : "Admin client unavailable.";
  }

  const activeCount = profiles.filter(p => p.isActive).length;

  return (
    <div className="flex flex-col">
      <SyncBar />
      <PageHeader
        category="HSE HUB / ADMIN"
        title="Users &amp; Roles"
        meta={`${activeCount} ACTIVE · ${profiles.length} TOTAL`}
        actions={
          <Link
            href="/admin/roles"
            className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
          >
            Role Permissions →
          </Link>
        }
      />

      <div className="flex flex-col gap-4 p-4 sm:gap-5 sm:p-6">
        {adminUnavailable && (
          <div
            className="flex items-start gap-3 border border-[var(--border)] p-3 text-sm"
            style={{ background: "var(--warning-wash)" }}
          >
            <span aria-hidden className="mt-0.5 text-base">⚠</span>
            <p className="text-[var(--text-primary)]">
              {adminUnavailable} Emails below are blank and invites will fail until it&apos;s set.
            </p>
          </div>
        )}

        {canEdit && <InviteUserForm roles={roles} people={people ?? []} />}

        <div className="border border-[var(--border)] bg-[var(--surface)]">
          {/* Table header */}
          <div className="hidden grid-cols-12 gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)] sm:grid">
            <span className="col-span-3">EMAIL</span>
            <span className="col-span-2">ROLE</span>
            <span className="col-span-2">DEPARTMENT</span>
            <span className="col-span-2">PERSON</span>
            <span className="col-span-1">STATUS</span>
            <span className="col-span-2 text-right">SINCE</span>
          </div>

          {profiles.length === 0 ? (
            <div className="px-4 py-8 text-center font-mono text-[11px] text-[var(--text-faint)]">
              NO ACCOUNTS YET
            </div>
          ) : (
            profiles.map((p) => (
              <UserRow
                key={p.userId}
                userId={p.userId}
                email={emailByUserId.get(p.userId) || ""}
                roleKey={p.roleKey}
                roleDisplayName={p.roleDisplayName}
                department={p.department}
                personName={p.personName}
                isActive={p.isActive}
                createdAt={p.createdAt}
                roles={roles}
                canEdit={canEdit}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
