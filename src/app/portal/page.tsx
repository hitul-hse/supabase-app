/**
 * Bridge portal — the landing page after sign-in. One account, then choose a
 * module.
 *
 * Route note: this is /portal, not /hub, even though "hub" is the module key.
 * /hub is already taken as a public marketing alias that next.config.ts
 * redirects to /demo, so a page there would be unreachable. /portal also
 * matches the portal.hs-experts.com hostname in PLATFORM-ARCHITECTURE.md.
 *
 * The tile list is NOT defined here. It comes from app_user_modules(), which
 * resolves the user's role → granted permissions → owning modules. Adding a
 * module or changing who sees it is a data change, not a deploy.
 */
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { requireProfile } from "@/utils/supabase/require-profile";
import { getUserModules, isModuleReachable } from "@/lib/queries/modules";
import { LogoutButton } from "@/components/LogoutButton";

export const metadata = {
  title: "HSE Platform",
  description: "Choose a module",
};

export default async function PortalPage() {
  const profile = await requireProfile("/portal");
  const supabase = await createClient();
  const modules = await getUserModules(supabase);

  const firstName = profile.personName?.split(" ")[0] ?? null;

  return (
    <div className="min-h-screen bg-[var(--surface)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface-2)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- brand mark is a fixed 499px asset; next/image adds no value and its loader is one more thing to configure for a self-hosted move */}
            <img src="/hse-logo.png" alt="" width={28} height={28} className="rounded" />
            <div>
              <p className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                HSE Platform
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                {profile.roleDisplayName}
                {profile.department ? ` · ${profile.department}` : ""}
              </p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          {firstName ? `Welcome back, ${firstName}.` : "Welcome back."}
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {modules.length === 1
            ? "You have access to one module."
            : `You have access to ${modules.length} modules.`}
        </p>

        {/* Empty state is a real path, not a formality: if the permission
            objects are missing from the database, app_user_modules() returns
            nothing and this is what the user sees. It says what to do next
            instead of rendering a blank page or an exception. */}
        {modules.length === 0 ? (
          <div className="mt-8 border border-[var(--border)] bg-[var(--surface-2)] p-6">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              No modules are available to you yet.
            </p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Your account is active, but no module permissions have been granted to
              the <strong>{profile.roleDisplayName}</strong> role. An administrator
              can assign them under Role Permissions.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {modules.map((m) => {
              const reachable = isModuleReachable(m);

              const inner = (
                <>
                  <span
                    aria-hidden
                    className="block h-1 w-10 rounded-full"
                    style={{ background: m.accent }}
                  />
                  <p className="mt-4 text-base font-semibold tracking-tight text-[var(--text-primary)]">
                    {m.displayName}
                  </p>
                  {m.tagline ? (
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">{m.tagline}</p>
                  ) : null}
                  <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                    {reachable ? "Open →" : "Coming soon"}
                  </p>
                </>
              );

              // A module with no href is in the registry but not yet routed.
              // Rendering it as a div rather than a Link keeps it visible
              // without becoming a dead link that 404s.
              return reachable ? (
                <Link
                  key={m.moduleKey}
                  href={m.href as string}
                  className="block border border-[var(--border)] bg-[var(--surface-2)] p-6 transition-colors hover:border-[var(--text-secondary)]"
                >
                  {inner}
                </Link>
              ) : (
                <div
                  key={m.moduleKey}
                  aria-disabled="true"
                  className="block cursor-default border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-6 opacity-60"
                >
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
