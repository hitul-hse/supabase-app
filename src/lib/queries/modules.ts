/**
 * Bridge-portal module registry reads.
 *
 * The portal's tile list comes from the database, never from an array in the
 * app. That is deliberate: a hardcoded tile list is a second source of truth
 * that drifts from the permission data, and the failure mode is the worst kind
 * — a tile that is visible but leads to a page the user is then bounced out of,
 * or a module someone may use but cannot find.
 *
 * app_user_modules() answers "which modules may I see?" in one round trip by
 * joining app_role_permission → app_permission.module_key → app_module. A
 * module appears when the user holds *any* permission belonging to it, so
 * granting a permission is the only action needed to reveal a module.
 */
import type { SupabaseTyped } from "./types";
import type { ModuleKey, ModuleTile } from "@/lib/permissions";

/** Every module in the catalogue, including hidden ones — for the admin view. */
export type ModuleRegistryRow = ModuleTile & {
  isLive: boolean;
  sortOrder: number;
  /** How many catalogue permissions belong to this module. */
  permissionCount: number;
};

/**
 * The tiles this user should see on the bridge portal.
 *
 * Returns [] rather than throwing when the RPC is unavailable. That case is
 * real, not theoretical: the permission objects were missing from the live
 * database for weeks, and during that window every RPC here 404'd. An empty
 * portal with a "no modules yet" message is a far better failure than an
 * exception page, and the admin console stays reachable by its own route.
 */
export async function getUserModules(supabase: SupabaseTyped): Promise<ModuleTile[]> {
  const { data, error } = await supabase.rpc("app_user_modules");

  if (error || !data) return [];

  return data.map((m) => ({
    moduleKey: m.module_key as ModuleKey,
    displayName: m.display_name,
    tagline: m.tagline,
    href: m.href,
    accent: m.accent,
  }));
}

/**
 * The whole catalogue with grant counts, for an admin screen that needs to show
 * modules nobody can currently see. Uses a plain select rather than the RPC
 * because the RPC deliberately filters to the caller's own visible set.
 */
export async function getModuleRegistry(
  supabase: SupabaseTyped,
): Promise<ModuleRegistryRow[]> {
  const [{ data: modules }, { data: perms }] = await Promise.all([
    supabase
      .from("app_module")
      .select("module_key, display_name, tagline, href, accent, is_live, sort_order")
      .order("sort_order"),
    supabase.from("app_permission").select("module_key"),
  ]);

  if (!modules) return [];

  const countByModule = new Map<string, number>();
  for (const p of perms ?? []) {
    countByModule.set(p.module_key, (countByModule.get(p.module_key) ?? 0) + 1);
  }

  return modules.map((m) => ({
    moduleKey: m.module_key as ModuleKey,
    displayName: m.display_name,
    tagline: m.tagline,
    href: m.href,
    accent: m.accent,
    isLive: m.is_live,
    sortOrder: m.sort_order,
    permissionCount: countByModule.get(m.module_key) ?? 0,
  }));
}

/**
 * A module tile is only clickable when the module is routed. href is nullable
 * on purpose so a module can sit in the registry while it is being built
 * without becoming a dead link — this is the check that keeps that promise.
 */
export function isModuleReachable(tile: ModuleTile): boolean {
  return typeof tile.href === "string" && tile.href.length > 0;
}
