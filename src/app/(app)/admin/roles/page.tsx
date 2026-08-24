import { PageHeader } from "@/components/PageHeader";
import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getRoles, getRolePermissionMatrix } from "@/lib/queries/auth";
import { PermissionToggle } from "./PermissionToggle";
import { Card, CardHeader, CardDivider } from "@/components/ui/Card";

/**
 * Role Permission Editor — /admin/roles
 *
 * Displays a matrix of every role × every permission. Exec users can toggle
 * each cell to grant or revoke that permission for a role in real-time.
 * Dept heads can VIEW the matrix but not edit it.
 */
export default async function AdminRolesPage() {
  const profile = await requirePermission("/admin/roles", PERMISSIONS.ADMIN_ROLES_READ);
  const canEdit = profile.roleKey === "exec";

  const supabase = await createClient();
  const [roles, { permissions, grantedByRole }] = await Promise.all([
    getRoles(supabase),
    getRolePermissionMatrix(supabase),
  ]);

  // Group permissions by resource for the matrix rows
  const resourceGroups = permissions.reduce<Record<string, typeof permissions>>((acc, p) => {
    if (!acc[p.resource]) acc[p.resource] = [];
    acc[p.resource].push(p);
    return acc;
  }, {});

  const resourceOrder = [...new Set(permissions.map((p) => p.resource))];

  return (
    <div className="flex flex-col">
      <SyncBar />
      <PageHeader
        category="HSE HUB / ADMIN"
        title="Role Permissions"
        meta={`${roles.length} ROLES · ${permissions.length} PERMISSIONS`}
      />

      <div className="flex flex-col gap-5 p-6">
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
            role × permission cell. The qualifier names the scale. */}
        <Card>
          <CardHeader title="Role Permissions" qualifier={`${roles.length} ROLES · ${permissions.length} PERMISSIONS`} />
          <CardDivider />
          <div className="overflow-x-auto p-0">
          {/* No own border or surface: the Card provides both. The CELL rules
              stay -- a matrix is genuinely fused cells of one record, the one
              shape where shared hairlines say the true thing. */}
          <table className="w-full min-w-[680px] border-collapse">
            {/* Header row: roles */}
            <thead>
              <tr className="bg-[var(--surface-2)]">
                <th className="border-b border-r border-[var(--border)] px-4 py-2.5 text-left font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                  PERMISSION
                </th>
                {roles.map((role) => (
                  <th
                    key={role.role_key}
                    className="border-b border-r border-[var(--border)] px-3 py-2.5 text-center font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)] last:border-r-0"
                  >
                    {role.display_name.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {resourceOrder.map((resource) => {
                const group = resourceGroups[resource] ?? [];
                return group.map((perm, idx) => (
                  <tr
                    key={perm.permissionKey}
                    className="border-b border-[var(--border)] hover:bg-[var(--surface-hover)]"
                  >
                    {/* Permission label */}
                    <td className="border-r border-[var(--border)] px-4 py-2">
                      {idx === 0 && (
                        <span className="mb-0.5 block font-mono text-[9px] tracking-[0.12em] text-[var(--text-faint)]">
                          {resource.toUpperCase()}
                        </span>
                      )}
                      <span className="block text-[12px] text-[var(--text-primary)]">
                        {perm.displayName}
                      </span>
                      {perm.description && (
                        <span className="block text-[10px] text-[var(--text-muted)]">
                          {perm.description}
                        </span>
                      )}
                    </td>

                    {/* Toggle per role */}
                    {roles.map((role) => {
                      const granted = !!(grantedByRole[role.role_key]?.has(perm.permissionKey));
                      return (
                        <td
                          key={role.role_key}
                          className="border-r border-[var(--border)] px-3 py-2 text-center last:border-r-0"
                        >
                          <div className="flex items-center justify-center">
                            <PermissionToggle
                              roleKey={role.role_key}
                              permissionKey={perm.permissionKey}
                              initialGranted={granted}
                              canEdit={canEdit}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ));
              })}
            </tbody>
          </table>
          </div>
        </Card>

        <p className="font-mono text-[10px] text-[var(--text-faint)]">
          Changes take effect immediately. RLS on the database enforces data-level access independently.
        </p>
      </div>
    </div>
  );
}
