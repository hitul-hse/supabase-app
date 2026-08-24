"use client";

/**
 * The role × permission matrix on the shared table primitive.
 *
 * WHY: the hand-rolled matrix rendered all 37 permissions unpaged, with no
 * sticky header, and nothing on the page said how many rows were on screen out
 * of the total — so a bounded list read as a truncated one and the role columns
 * became unlabelled checkboxes the moment you scrolled. Measured at 1440×900 the
 * table alone was 2,072px.
 *
 * The row count IS bounded by the schema (one row per app_permission), which is
 * why a hand-rolled table was defensible, but DESIGN.md rules 3, 5 and 7 still
 * apply to a bounded matrix, and the primitive gives all three plus search and
 * paging for free. Nothing is hidden: the footnote states the full totals over
 * every permission and every role, computed over the WHOLE set rather than the
 * visible page.
 *
 * RESOURCE became its own column. The old markup printed the resource name
 * inside the first cell of each group, which silently lies as soon as a reader
 * sorts or pages — the group label would sit on whatever row happened to land
 * first. A real column survives both, and feeds the search box.
 */

import { DataTable, cmpText, type Column } from "@/components/data-table/DataTable";
import type { AppPermission } from "@/lib/queries/auth";
import { PermissionToggle } from "./PermissionToggle";

type Role = { role_key: string; display_name: string };

export function RolePermissionMatrix({
  roles,
  permissions,
  grantedByRole,
  canEdit,
}: {
  roles: Role[];
  permissions: AppPermission[];
  /** role_key → the permission keys that role holds. */
  grantedByRole: Record<string, string[]>;
  canEdit: boolean;
}) {
  const granted = (roleKey: string, permissionKey: string) =>
    grantedByRole[roleKey]?.includes(permissionKey) ?? false;

  const columns: Column<AppPermission>[] = [
    {
      key: "permission",
      header: "PERMISSION",
      className: "min-w-[15rem]",
      compare: (a, b) => cmpText(a.displayName, b.displayName),
      descFirst: false,
      cell: (perm) => (
        <span className="block">
          <span className="block text-[12px] text-[var(--text-primary)]">{perm.displayName}</span>
          {perm.description && (
            <span className="block text-[10px] text-[var(--text-muted)]">{perm.description}</span>
          )}
        </span>
      ),
      csv: (perm) => perm.displayName,
      search: (perm) => `${perm.displayName} ${perm.description ?? ""} ${perm.permissionKey}`,
    },
    {
      key: "resource",
      header: "RESOURCE",
      className: "w-[8rem]",
      compare: (a, b) => cmpText(a.resource, b.resource) || a.sortOrder - b.sortOrder,
      descFirst: false,
      cell: (perm) => (
        <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--text-faint)]">
          {perm.resource.toUpperCase()}
        </span>
      ),
      csv: (perm) => perm.resource,
      search: (perm) => perm.resource,
      title: "The area of the app this permission governs",
    },
    ...roles.map<Column<AppPermission>>((role) => ({
      key: role.role_key,
      header: role.display_name.toUpperCase(),
      align: "right",
      className: "w-[6rem]",
      // Sorting a role column groups the permissions it holds together, which is
      // how "what can a dept head actually do" gets answered in one glance.
      compare: (a, b) =>
        Number(granted(role.role_key, a.permissionKey)) -
        Number(granted(role.role_key, b.permissionKey)),
      cell: (perm) => (
        <span className="flex items-center justify-end">
          <PermissionToggle
            roleKey={role.role_key}
            permissionKey={perm.permissionKey}
            initialGranted={granted(role.role_key, perm.permissionKey)}
            canEdit={canEdit}
          />
        </span>
      ),
      csv: (perm) => (granted(role.role_key, perm.permissionKey) ? "granted" : "not granted"),
      title: `Toggle a permission for ${role.display_name}`,
    })),
  ];

  // Totals over EVERY permission and EVERY role, never over the page on screen.
  const grantTotal = roles.reduce(
    (sum, role) =>
      sum + permissions.filter((perm) => granted(role.role_key, perm.permissionKey)).length,
    0,
  );
  const cellTotal = roles.length * permissions.length;
  const ungranted = permissions.filter(
    (perm) => !roles.some((role) => granted(role.role_key, perm.permissionKey)),
  ).length;

  return (
    <DataTable
      rows={permissions}
      columns={columns}
      rowKey={(perm) => perm.permissionKey}
      title="Role Permissions"
      hint={`${roles.length} ROLES · ${permissions.length} PERMISSIONS`}
      initialSort="resource"
      initialDesc={false}
      exportName="role-permissions"
      searchPlaceholder="Permission, resource…"
      defaultPageSize={25}
      // Six-ish columns of checkboxes are narrow enough not to scroll sideways,
      // so the first column only gets frozen once the roles make it wide.
      freezeFirstColumn={roles.length + 2 > 8}
      maxBodyHeight="56vh"
      emptyText="No permissions are defined in app_permission."
      footnote={
        <span className="block leading-relaxed">
          {grantTotal} of {cellTotal} role × permission cells are granted across all{" "}
          {roles.length} roles and all {permissions.length} permissions
          {ungranted > 0 ? ` · ${ungranted} permission(s) granted to no role` : ""}.
        </span>
      }
    />
  );
}
