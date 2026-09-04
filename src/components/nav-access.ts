/**
 * Which routes a RESTRICTED role may reach — one allow-list, read by both the
 * navigation and the server-side page guards.
 *
 * NO "use client" DIRECTIVE, deliberately, and no imports at all. This module is
 * consumed from three places that cannot all take the same kind of file:
 *
 *   - SidebarNav / MobileTabBar   client components
 *   - require-profile.ts          server-only page guards
 *   - check-operations-role.mjs   a plain Node gate, which imports this file
 *                                 directly under --experimental-strip-types and
 *                                 executes the real predicate rather than a
 *                                 reimplementation of it
 *
 * A "use client" module would hand the server a client-reference PROXY instead
 * of the value — a bug this codebase has already shipped once (see
 * sidebar-collapse-shared.ts). Keeping this file dependency-free is what makes
 * all three call sites legitimate.
 *
 * WHY AN ALLOW-LIST AND NOT `roles: [...]` ON EVERY NAV ITEM
 * ---------------------------------------------------------
 * NAV_GROUPS' `roles` array is a DENY-BY-OMISSION list: an item with no `roles`
 * key is visible to everybody. Restricting a role by that mechanism means
 * adding the new role string to the `roles` array of every item it MAY see, and
 * adding a `roles` array to each of the five items that currently have none —
 * which silently converts them from "everyone" to "these named roles", so the
 * next role added has to be threaded through ten places or it sees nothing.
 * That is the wrong default and it fails quietly.
 *
 * This inverts it for the roles that need inverting. One entry per restricted
 * role, in one file, saying the whole truth about that role in one line. Adding
 * `operations` was one line here; adding the next restricted role is one more.
 * Roles absent from this table are completely unaffected — `isRouteAllowedForRole`
 * returns true for them before it looks at anything else, which is the property
 * that lets this ship without re-testing every existing role's navigation.
 *
 * IT GOVERNS ROUTES, NOT JUST NAV ITEMS. Hiding a sidebar link does not stop
 * anyone typing the URL, so the same table is what `enforceRoleRouteAccess()` in
 * src/utils/supabase/require-profile.ts consults. One list, two enforcement
 * points, no way for the menu and the door to disagree.
 */

/** The shape `isNavItemVisible` needs from a NAV_GROUPS entry. */
export interface NavItemLike {
  href: string;
  roles?: readonly string[];
}

/**
 * Roles that may reach ONLY the routes listed, and the reason each list is what
 * it is. A role that is not a key here is unrestricted by this mechanism.
 *
 * `operations` — hitul's decision, 2026-09-04, reaffirmed after the consequences
 * were put to him: the operations consultants see My Work and nothing else for
 * the duration of the trial. No Overview, People, Projects, Timesheets,
 * TrackingTime Dashboard or Leave.
 *
 * `/profile` is on the list and is the one entry that is a judgement call rather
 * than a transcription of that decision, so it is called out here rather than
 * left to be discovered. It is not a nav item and carries no business data: it
 * is the account page behind the avatar chip in the sidebar footer — own display
 * name, own photo, own password, own language. The chip is rendered on every
 * page for every role, so excluding /profile would leave six people with a
 * permanently dead control and no way to change their own password or switch to
 * German. If that is not wanted, delete the one array element; nothing else
 * needs to change.
 */
export const ROLE_ROUTE_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  operations: ["/my-work", "/profile"],
};

/**
 * Where a restricted role is sent when it asks for something off its list, and
 * where every other redirect-to-"/" in the app effectively lands it.
 *
 * This MUST be a member of that role's own allow-list or the redirect loops.
 * `enforceRoleRouteAccess` refuses to redirect a path to itself as a runtime
 * backstop, and scripts/check-operations-role.mjs asserts the invariant
 * directly for every entry in the table.
 */
export const ROLE_HOME: Readonly<Record<string, string>> = {
  operations: "/my-work",
};

/**
 * `Object.hasOwn`, not `key in obj` and not a bare lookup.
 *
 * role_key is a database value: it is a foreign key into app_role, and an exec
 * can create a role from /admin/roles. A role literally named `toString` or
 * `constructor` would make `key in obj` true and hand the caller a function off
 * Object.prototype, which then blows up on `.some(...)` — an unrelated role
 * definition crashing every page render. Own-property lookups cannot do that.
 */
function own<T>(table: Readonly<Record<string, T>>, key: string | null): T | undefined {
  if (!key) return undefined;
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Is this role restricted to a fixed set of routes at all? */
export function isRestrictedRole(roleKey: string | null): boolean {
  return own(ROLE_ROUTE_ALLOWLIST, roleKey) !== undefined;
}

/** The landing route for a role: its own home when restricted, "/" otherwise. */
export function roleHome(roleKey: string | null): string {
  return own(ROLE_HOME, roleKey) ?? "/";
}

/**
 * May this role open this path?
 *
 * Prefix matching on a SEGMENT boundary (`/my-work/x`, never `/my-workshop`),
 * because the allow-list names route roots and the real routes have children —
 * /projects/[id], /admin/users/[userId]. A bare `startsWith` would let
 * "/profiles-of-everyone" through on the strength of "/profile".
 *
 * Unrestricted roles return true immediately, so this function cannot change
 * the behaviour of any role that is not named in the table above.
 */
export function isRouteAllowedForRole(roleKey: string | null, path: string): boolean {
  const allowed = own(ROLE_ROUTE_ALLOWLIST, roleKey);
  if (!allowed) return true;
  return allowed.some((a) => path === a || path.startsWith(`${a}/`));
}

/**
 * The nav filter, for one item.
 *
 * Two independent rules, both of which must pass, and the order is not
 * arbitrary: the allow-list is checked FIRST so a restricted role can never
 * inherit an item merely because the item has no `roles` key. That inheritance
 * is exactly what would have handed `operations` My Work, People, Projects,
 * Timesheets, Leave and Overview.
 */
export function isNavItemVisible(roleKey: string | null, item: NavItemLike): boolean {
  if (!isRouteAllowedForRole(roleKey, item.href)) return false;
  return !item.roles || (!!roleKey && item.roles.includes(roleKey));
}
