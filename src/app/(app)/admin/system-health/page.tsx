import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import PageTransition from "@/components/animations/PageTransition";
import { Card, CardHeader } from "@/components/ui/Card";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getSystemHealth } from "@/lib/queries/system-health";
import { readHealthHistory } from "@/lib/health-history";
import { computeHealthScore } from "@/lib/health-score";
import { buildHealthView } from "./view";
import type { Locale } from "@/i18n/request";
import { HealthHero } from "./HealthHero";
import { FreshnessPanel } from "./FreshnessPanel";
import { EfficiencyPanel } from "./EfficiencyPanel";
import { SecurityPanel } from "./SecurityPanel";
import { ConsumptionPanel } from "./ConsumptionPanel";

/**
 * The developer health portal.
 *
 * WHO SEES IT. admin:roles:write is the one administrative key the schema
 * withholds from every non-exec role by name ("HR must not be able to grant
 * itself exec", add_hr_role_and_profile_admin.sql). hr holds admin:users:write
 * and even admin:entries:write, so those would not keep this page exec-only.
 * The permission is checked in the database like every other route; the
 * sidebar's roles filter only decides whether the link is drawn.
 *
 * WHAT IT IS NOT. Not a dashboard of the business -- that is /dashboard/
 * management. This page answers "can the numbers on the other pages be
 * trusted right now": when data last arrived, whether the database is
 * healthy, whether every table is behind RLS, what the deployment is.
 *
 * EVERY FIGURE IS AS OF ONE INSTANT. Rendered on the server per request, no
 * cache, direct Postgres. The header carries the sample time so a screenshot
 * pasted into a thread dates itself.
 *
 * HOW IT IS BUILT. Two reads, in parallel and nothing else: the live snapshot
 * (`getSystemHealth`, one Postgres connection, every statement a SELECT) and
 * the rig's sample history (`readHealthHistory`, a JSONL file; n/a on Vercel).
 * `computeHealthScore` is pure and turns both into the composite. `view.ts`
 * then turns all three into serialisable data for the client panels, which
 * draw and never decide -- so `Metric<T> = {ok,value} | {ok:false,reason}`
 * is applied in one place and a chart can never render a plausible number
 * where the truth is "not measured".
 */
export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
  await requirePermission("/admin/system-health", PERMISSIONS.ADMIN_ROLES_WRITE);
  const [t, locale] = await Promise.all([getTranslations("systemHealth"), getLocale()]);

  const [health, history] = await Promise.all([getSystemHealth(), readHealthHistory()]);
  const score = computeHealthScore(health, history);
  const view = buildHealthView(t, health, history, score, locale as Locale);
  const { header } = view;

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          title={header.title}
          meta={header.meta}
          actions={
            <span
              data-metric="server-ms"
              className="rounded-[var(--radius-sm)] border px-2 py-0.5 font-mono text-[10px] tracking-[0.06em]"
              style={{
                borderColor: header.serverTone === "warning" ? "var(--warning)" : "var(--border)",
                color: header.serverTone === "warning" ? "var(--warning)" : "var(--text-muted)",
              }}
            >
              {header.serverLabel}
            </span>
          }
        />
        <main className="stagger flex flex-col gap-[var(--card-gap)] page-shell">
          {view.dbError && (
            <Card as="section" data-section="db-error">
              <CardHeader title={t("dbErrorTitle")} qualifier={t("dbErrorQualifier")} />
              <p className="px-4 pb-4 font-mono text-[11px] text-[var(--critical)]">{view.dbError}</p>
            </Card>
          )}

          <HealthHero hero={view.hero} />
          <FreshnessPanel view={view.freshness} dbError={view.dbError} />
          <EfficiencyPanel view={view.efficiency} dbError={view.dbError} />
          <SecurityPanel view={view.security} />
          <ConsumptionPanel view={view.consumption} dbError={view.dbError} />
        </main>
      </div>
    </PageTransition>
  );
}
