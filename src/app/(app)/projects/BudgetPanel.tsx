import type { ProjectBudgetStatusRow } from "@/lib/queries/types";

const euro = (value: number) => `€${Math.round(value).toLocaleString("de-DE")}`;

/**
 * Budget burn and margin for a project.
 *
 * Deliberately shows margin next to revenue rather than revenue alone: a
 * project can invoice well and still lose money once non-billable hours are
 * paid for, and revenue on its own hides that.
 */
export function BudgetPanel({ status }: { status: ProjectBudgetStatusRow | null }) {
  if (!status) return null;

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
    : "var(--accent)";

  return (
    <section className="flex flex-col gap-4 border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Budget &amp; margin</h2>
          <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
            APPROVED HOURS ONLY
          </span>
        </div>

        {overBudget && (
          <span className="bg-[var(--critical-wash)] px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--critical)]">
            Over budget
          </span>
        )}
        {nearLimit && (
          <span className="bg-[var(--warning-wash)] px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--warning)]">
            Past {status.budget_alert_percent}% alert
          </span>
        )}
      </div>

      {budgetHours == null ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          No hours budget set for this project, so there is nothing to burn down against. An
          exec can set one to enable overrun warnings.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between font-mono text-[11px]">
            <span className="text-[var(--text-secondary)]">
              {hoursLogged} of {budgetHours} h
            </span>
            <span style={{ color: barColor }}>{percent ?? 0}%</span>
          </div>
          <div
            className="h-2 w-full bg-[var(--surface-2)]"
            role="progressbar"
            aria-valuenow={percent ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Hours budget consumed"
          >
            <div
              className="h-full transition-[width] duration-500"
              style={{
                width: `${Math.min(100, percent ?? 0)}%`,
                background: barColor,
              }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--border)] pt-4 sm:grid-cols-4">
        <Figure label="BILLABLE HOURS" value={`${Number(status.billable_hours_logged ?? 0)} h`} />
        <Figure label="REVENUE" value={euro(revenue)} />
        <Figure label="COST" value={euro(cost)} hint="all hours, billable or not" />
        <Figure
          label="MARGIN"
          value={euro(margin)}
          color={margin < 0 ? "var(--critical)" : "var(--good)"}
        />
      </div>
    </section>
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
