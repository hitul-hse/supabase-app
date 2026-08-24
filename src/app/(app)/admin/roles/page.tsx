import { PageHeader } from "@/components/PageHeader";
import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getRoles, getRolePermissionMatrix } from "@/lib/queries/auth";
import { RolePermissionMatrix } from "./RolePermissionMatrix";

/**
 * Role Permission Editor — /admin/roles
 *
 * Displays a matrix of every role × every permission. Exec users can toggle
 * each cell to grant or revoke that permission for a role in real-time.
 * Dept heads can VIEW the matrix but not edit it.
 *
 * The matrix renders through the shared DataTable (RolePermissionMatrix.tsx).
 * The hand-rolled version dumped all 37 permissions unpaged with no sticky
 * header, which made this page 2,351px tall and turned the role columns into
 * unlabelled checkboxes the moment you scrolled. Every permission is still
 * reachable and the totals are stated over the whole set.
 */
export default async function AdminRolesPage() {
  const profile = await requirePermission("/admin/roles", PERMISSIONS.ADMIN_ROLES_READ);
  const canEdit = profile.roleKey === "exec";

  const supabase = await createClient();
  const [roles, { permissions, grantedByRole }] = await Promise.all([
    getRoles(supabase),
    getRolePermissionMatrix(supabase),
  ]);

  // A Set cannot cross the server/client boundary, so the grants go over as
  // arrays. Same data, serialisable.
  const grantedArrays = Object.fromEntries(
    Object.entries(grantedByRole).map(([roleKey, keys]) => [roleKey, [...keys]]),
  );

  return (
    <div className="flex flex-col">
      <SyncBar />
      <PageHeader
        category="HSE HUB / ADMIN"
        title="Role Permissions"
        meta={`${roles.length} ROLES · ${permissions.length} PERMISSIONS`}
      />

      <div className="flex flex-col gap-5 page-shell">
        {!canEdit && (
          <div
            className="flex items-start gap-3 border border-[var(--border)] p-3 text-sm"
            style={{ background: "var(--surface-2)" }}
          >
            <span aria-hidden className="mt-0.5 text-base">ℹ</span>
            <p className="text-[var(--text-secondary)]">
              You can view the permission matrix but only Executives can edit it.
            </p>
          </div>
        )}

        {/* The permission matrix is the page's primary panel: every
            role × permission cell, paged with its header pinned. */}
        <RolePermissionMatrix
          roles={roles}
          permissions={permissions}
          grantedByRole={grantedArrays}
          canEdit={canEdit}
        />

        <p className="font-mono text-[10px] text-[var(--text-faint)]">
          Changes take effect immediately. RLS on the database enforces data-level access independently.
        </p>
      </div>
    </div>
  );
}
