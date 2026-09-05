import { getLocale, getTranslations } from "next-intl/server";
import type { ProjectBudgetStatusRow } from "@/lib/queries/types";
import { Card } from "@/components/ui/Card";
import { fmtInt, tagFor } from "@/lib/locale-format";

/**
 * Euros in the reader's language.
 *
 * This used to pin de-DE unconditionally, which was right when the whole Hub
 * printed German digits and wrong once the reader can choose: an English page
 * would have shown "€1.234" beside "1,234.5h". It follows the request locale
 * like every other figure on these pages.
 */
const euro = (value: number, locale: string) => `€${fmtInt(value, locale)}`;

/**
 * Budget burn and margin for a project.
 *
 * Deliberately shows margin next to revenue rather than revenue alone: a
 * project can invoice well and still lose money once non-billable hours are
 * paid for, and revenue on its own hides that.
 */
export async function BudgetPanel({ status }: { status: ProjectBudgetStatusRow | null }) {
  if (!status) return null;

  const t = await getTranslations("projects.budgetPanel");
  const locale = await getLocale();
  const num = (n: number) => n.toLocaleString(tagFor(locale), { maximumFractionDigits: 1 });

  const hoursLogged = Number(status.hours_logged ?? 0);
  const budgetHours = status.budget_hours == null ? null : Number(status.budget_hours);
  const percent =
    status.hours_consumed_percent == null ? null : Number(status.hours_consumed_percent);
  const margin = Number(status.margin_eur ?? 0);
  const revenue = Number(status.revenue_eur ?? 0);
  const cost = Number(status.cost_eur ?? 0);

  const overBudget = status.is_over_budget === true;
  const nearLimit = status.is_past_alert_threshold === true && !overBudget;

  const barColor = overBudget
    ? "var(--critical)"
    : nearLimit
    ? "var(--warning)"
    : "var(--good)";

  return (
    <Card as="section" className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">{t("title")}</h2>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">{t("qualifier")}</span>
        </div>

        {overBudget && (
          <span className="bg-[var(--critical-wash)] px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--critical)]">
            {t("overBudget")}
          </span>
        )}
        {nearLimit && (
          <span className="bg-[var(--warning-wash)] px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--warning)]">
            {t("pastAlert", { percent: status.budget_alert_percent ?? 0 })}
          </span>
        )}
      </div>

      {budgetHours == null ? (
        <p className="text-[12px] text-[var(--text-muted)]">{t("noBudget")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between font-mono text-[11px]">
            <span className="text-[var(--text-secondary)]">
              {t("ofHours", { logged: num(hoursLogged), budget: num(budgetHours) })}
            </span>
            <span style={{ color: barColor }}>{percent ?? 0}%</span>
          </div>
          <div
            className="h-2 w-full bg-[var(--surface-2)]"
            role="progressbar"
            aria-valuenow={percent ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("barLabel")}
          >
            <div
              className="h-full"
              style={{
                width: `${Math.min(100, percent ?? 0)}%`,
                background: barColor,
              }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--border)] pt-4 sm:grid-cols-4">
        <Figure
          label={t("billableHours")}
          value={t("hours", { hours: num(Number(status.billable_hours_logged ?? 0)) })}
        />
        <Figure label={t("revenue")} value={euro(revenue, locale)} />
        <Figure label={t("cost")} value={euro(cost, locale)} hint={t("costHint")} />
        <Figure
          label={t("margin")}
          value={euro(margin, locale)}
          color={margin < 0 ? "var(--critical)" : "var(--good)"}
        />
      </div>
    </Card>
  );
}

function Figure({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: string;
  color?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
        {label}
      </span>
      <span
        className="font-mono text-[18px] font-semibold"
        style={{ color: color ?? "var(--text-primary)" }}
      >
        {value}
      </span>
      {hint && <span className="text-[10px] text-[var(--text-faint)]">{hint}</span>}
    </div>
  );
}
