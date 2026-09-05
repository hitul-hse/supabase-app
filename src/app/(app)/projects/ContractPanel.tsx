"use client";

/**
 * The contract panel: what sales agreed, how much of it is used, and the
 * history of every previous term.
 *
 * WHY THE HISTORY IS AS PROMINENT AS THE CURRENT TERM. A renewal deliberately
 * does not overwrite the previous period, so the previous budget and the hours
 * booked against it survive. That record is the reason the feature exists -- it
 * answers "what did last year's contract actually cost us?" -- so it gets a
 * real table rather than being hidden behind a disclosure.
 *
 * WHY THE FORMS LIVE HERE AND NOT ON A SEPARATE PAGE. Recording terms happens
 * while looking at the burn, and a renewal decision is made from the numbers
 * directly above it. Splitting them would mean re-reading the same figures on
 * another screen.
 */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { ContractPeriodRow } from "@/lib/queries/contract-periods";
import {
  setContractTerms,
  renewContract,
  correctContractPeriod,
  type ContractActionResult,
} from "./contract-actions";
import { Card } from "@/components/ui/Card";
import { buttonClass } from "@/components/ui/Button";
import { controlClass } from "@/components/ui/Field";
import { fmtNum, fmtPct } from "@/lib/locale-format";

const LABEL =
  "block font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]";
/*
 * The house field and button skins, not a third dialect. The fields used to
 * be square boxes on --surface-2 and the buttons 11px uppercase mono outlines;
 * this panel is the one place on the project record a person types, and it
 * should look like the leave form and the invite form, which already wear
 * these. PRIMARY is the one accent-filled action per form (record / renew /
 * save), SECONDARY the way out beside it.
 */
const FIELD = `${controlClass} w-full px-2.5 py-1.5 disabled:opacity-50`;
const PRIMARY = buttonClass("primary", "sm");
const SECONDARY = buttonClass("secondary", "sm");

/**
 * Dates stay as the ISO strings the database holds (yyyy-mm-dd) in both
 * languages: they are also what the two date inputs below round-trip, and a
 * localised display beside an ISO input would read as two different values for
 * the same field.
 */

/** Burn colour, matching the thresholds used elsewhere in the app. */
function burnTone(percent: number | null, warnAt: number): string {
  if (percent === null) return "var(--text-secondary)";
  if (percent > 100) return "var(--critical)";
  if (percent >= warnAt) return "var(--warning, #d99b3d)";
  return "var(--accent)";
}

/** A proportional bar. Over 100% it stays full and turns critical. */
function BurnBar({ percent, warnAt }: { percent: number | null; warnAt: number }) {
  const t = useTranslations("projects.contract");
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]"
      role="img"
      aria-label={
        percent === null
          ? t("barNoBudget")
          : t("barUsed", { percent: percent.toFixed(0) })
      }
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${clamped}%`, backgroundColor: burnTone(percent, warnAt) }}
      />
    </div>
  );
}

/** One of the three writes, as the panel hands it to `run`. */
type ContractRunner = () => Promise<ContractActionResult>;

function Feedback({ result }: { result: ContractActionResult | null }) {
  if (!result?.message) return null;
  return (
    <p
      className="mt-2 text-[11px] leading-relaxed"
      style={{ color: result.ok ? "var(--accent)" : "var(--critical)" }}
      role={result.ok ? "status" : "alert"}
    >
      {result.message}
    </p>
  );
}

/**
 * The shared field set. Used by all three forms because the terms are the same
 * shape whether they are being set, renewed or corrected -- and duplicating the
 * inputs three times is how they drift apart.
 */
function TermFields({
  disabled,
  defaults,
}: {
  disabled: boolean;
  defaults?: Partial<ContractPeriodRow>;
}) {
  const t = useTranslations("projects.contract");
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className={LABEL} htmlFor="budget_hours">
          {t("fields.budgetHours")}
        </label>
        <input
          id="budget_hours"
          name="budget_hours"
          type="text"
          inputMode="decimal"
          required
          disabled={disabled}
          defaultValue={defaults?.budgetHours ?? ""}
          placeholder={t("fields.budgetHoursPlaceholder")}
          className={FIELD}
        />
      </div>
      <div>
        <label className={LABEL} htmlFor="starts_on">
          {t("fields.startsOn")}
        </label>
        <input
          id="starts_on"
          name="starts_on"
          type="date"
          required
          disabled={disabled}
          defaultValue={defaults?.startsOn ?? ""}
          className={FIELD}
        />
      </div>
      <div>
        <label className={LABEL} htmlFor="ends_on">
          {t("fields.endsOn")}
        </label>
        <input
          id="ends_on"
          name="ends_on"
          type="date"
          required
          disabled={disabled}
          defaultValue={defaults?.endsOn ?? ""}
          className={FIELD}
        />
      </div>
      <div>
        <label className={LABEL} htmlFor="contract_reference">
          {t("fields.reference")}
        </label>
        <input
          id="contract_reference"
          name="contract_reference"
          type="text"
          disabled={disabled}
          defaultValue={defaults?.contractReference ?? ""}
          placeholder={t("fields.optional")}
          className={FIELD}
        />
      </div>
      <div>
        <label className={LABEL} htmlFor="warn_at_percent">
          {t("fields.warnAt")}
        </label>
        <input
          id="warn_at_percent"
          name="warn_at_percent"
          type="number"
          min={1}
          max={100}
          disabled={disabled}
          defaultValue={defaults?.warnAtPercent ?? 80}
          className={FIELD}
        />
        <p className="mt-1 text-[10px] leading-snug text-[var(--text-faint)]">
          {t("fields.warnAtHint")}
        </p>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={LABEL} htmlFor="notes">
          {t("fields.notes")}
        </label>
        <input
          id="notes"
          name="notes"
          type="text"
          disabled={disabled}
          defaultValue={defaults?.notes ?? ""}
          placeholder={t("fields.optional")}
          className={FIELD}
        />
      </div>
    </div>
  );
}

export function ContractPanel({
  projectId,
  periods,
  canWrite,
  featureInstalled,
  fallbackEstimateHours,
  locale,
}: {
  projectId: number;
  periods: ContractPeriodRow[];
  canWrite: boolean;
  /**
   * Whether the contract feature exists in the DATABASE yet.
   *
   * Without this, an unapplied migration makes canWrite false for everybody and
   * the panel tells an executive that only executives may record terms. The two
   * causes need opposite actions, so they must be told apart.
   */
  featureInstalled: boolean;
  /**
   * The vendor's estimate, shown ONLY when no contract is recorded and clearly
   * labelled as such. It is what the budget guard falls back to, so hiding it
   * would leave people wondering where a refusal came from.
   */
  fallbackEstimateHours: number | null;
  /** The request locale, handed down by the page. Absent means en-GB. */
  locale?: string;
}) {
  const t = useTranslations("projects.contract");
  const tc = useTranslations("common");
  /** Hours to one decimal, in the reader's language. */
  const h = (n: number) => fmtNum(n, locale, 1);
  const [result, setResult] = useState<ContractActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [renewing, setRenewing] = useState(false);
  const [correcting, setCorrecting] = useState<number | null>(null);

  const current = periods.find((p) => p.isCurrent) ?? null;
  const latest = periods[0] ?? null;
  const history = periods.filter((p) => p.id !== current?.id);

  const run = (fn: ContractRunner) =>
    startTransition(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        setRenewing(false);
        setCorrecting(null);
      }
    });

  return (
    <Card as="section">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--divider)] px-4 py-3">
        <div>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
            {t("title")}
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">{t("intro")}</p>
        </div>
        {canWrite && periods.length > 0 && !renewing && (
          <button
            type="button"
            onClick={() => {
              setRenewing(true);
              setResult(null);
            }}
            className={PRIMARY}
          >
            {t("renew")}
          </button>
        )}
      </header>

      {/* ------------------------------------------------- no contract yet */}
      {periods.length === 0 && (
        <div className="px-4 py-4">
          <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
            {t("none")}
            {fallbackEstimateHours !== null && fallbackEstimateHours > 0
              ? t.rich("fallback", {
                  hours: `${h(fallbackEstimateHours)}h`,
                  strong: (chunks) => (
                    <strong className="text-[var(--text-primary)]">{chunks}</strong>
                  ),
                })
              : t("noBudgetToEnforce")}
          </p>

          {!featureInstalled ? (
            <div className="mt-4 flex flex-col gap-2 border-t border-[var(--border)] pt-4">
              <p className="text-[12px] leading-relaxed text-[var(--text-primary)]">
                {t("notInstalled.title")}
              </p>
              <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {/* The two migration paths are file names, not prose: they stay
                    verbatim in both languages and only the sentence around
                    them moves. */}
                {t.rich("notInstalled.apply", {
                  first: () => (
                    <code className="font-mono text-[11px] text-[var(--text-primary)]">
                      supabase/migrations/add_contract_periods.sql
                    </code>
                  ),
                  second: () => (
                    <code className="font-mono text-[11px] text-[var(--text-primary)]">
                      supabase/migrations/add_budget_alert_visibility.sql
                    </code>
                  ),
                })}
              </p>
            </div>
          ) : canWrite ? (
            <form
              action={(fd) => run(() => setContractTerms(fd))}
              className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-4"
            >
              <input type="hidden" name="project_id" value={projectId} />
              <TermFields disabled={pending} />
              <div>
                <button
                  type="submit"
                  disabled={pending}
                  className={PRIMARY}
                >
                  {pending ? t("recording") : t("record")}
                </button>
              </div>
            </form>
          ) : (
            <p className="mt-2 text-[11px] text-[var(--text-faint)]">
              {t("noPermission")}
            </p>
          )}
          <Feedback result={result} />
        </div>
      )}

      {/* ------------------------------------------------- the current term */}
      {periods.length > 0 && (
        <div className="px-4 py-4">
          {current === null && latest !== null && (
            <p className="mb-4 border border-[var(--critical)] px-3 py-2 text-[11px] leading-relaxed text-[var(--critical)]">
              {t("gap", { period: latest.periodNo, endsOn: latest.endsOn })}
            </p>
          )}

          {current !== null && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                  {t("period", {
                    period: current.periodNo,
                    // A contract reference is a proper noun; interpolated whole
                    // so the separator does not strand when it is absent.
                    reference: current.contractReference ? ` · ${current.contractReference}` : "",
                  })}
                </span>
                <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                  {t("dates", {
                    startsOn: current.startsOn,
                    endsOn: current.endsOn,
                    remaining:
                      current.daysRemaining >= 0
                        ? t("daysLeft", { days: current.daysRemaining })
                        : t("ended"),
                  })}
                </span>
              </div>

              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span
                  className="font-mono text-[24px] font-semibold tracking-[-0.02em]"
                  style={{ color: burnTone(current.burnPercent, current.warnAtPercent) }}
                >
                  {t("hoursOf", {
                    logged: h(current.loggedHours),
                    budget: h(current.budgetHours),
                  })}
                </span>
                <span
                  className="font-mono text-[13px]"
                  style={{ color: burnTone(current.burnPercent, current.warnAtPercent) }}
                >
                  {current.burnPercent === null
                    ? tc("notAvailable")
                    : fmtPct(current.burnPercent, locale)}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {current.remainingHours >= 0
                    ? t("remaining", { hours: h(current.remainingHours) })
                    : t("overBudget", { hours: h(Math.abs(current.remainingHours)) })}
                </span>
              </div>

              <BurnBar percent={current.burnPercent} warnAt={current.warnAtPercent} />

              <p className="text-[11px] text-[var(--text-faint)]">
                {t("warnNote", { percent: current.warnAtPercent })}
              </p>

              {canWrite && correcting !== current.id && (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setCorrecting(current.id);
                      setResult(null);
                    }}
                    className={SECONDARY}
                  >
                    {t("correct")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------- renew form */}
          {renewing && canWrite && (
            <form
              action={(fd) => run(() => renewContract(fd))}
              className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-4"
            >
              <input type="hidden" name="project_id" value={projectId} />
              <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {t("renewIntro", { period: latest?.periodNo ?? 1 })}
              </p>
              <TermFields
                disabled={pending}
                // Pre-fill the previous budget and threshold: a renewal is
                // usually the same shape as what it replaces, and typing it
                // again is where transcription errors come from.
                defaults={{
                  budgetHours: latest?.budgetHours,
                  warnAtPercent: latest?.warnAtPercent,
                  startsOn: latest ? nextDay(latest.endsOn) : undefined,
                }}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={pending}
                  className={PRIMARY}
                >
                  {pending ? t("renewing") : t("confirmRenewal")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setRenewing(false)}
                  className={SECONDARY}
                >
                  {t("cancel")}
                </button>
              </div>
            </form>
          )}

          {/* ----------------------------------------------- correct form */}
          {correcting !== null && canWrite && (
            <form
              action={(fd) => run(() => correctContractPeriod(fd))}
              className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-4"
            >
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="period_id" value={correcting} />
              <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {t("correctIntro")}
              </p>
              <TermFields
                disabled={pending}
                defaults={periods.find((p) => p.id === correcting)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={pending}
                  className={PRIMARY}
                >
                  {pending ? t("saving") : t("saveCorrection")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setCorrecting(null)}
                  className={SECONDARY}
                >
                  {t("cancel")}
                </button>
              </div>
            </form>
          )}

          <Feedback result={result} />

          {/* --------------------------------------------------- history */}
          {history.length > 0 && (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                {t("history.title")}
              </h3>
              <p className="mt-0.5 mb-2 text-[11px] text-[var(--text-faint)]">
                {t("history.intro")}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                      <th className="py-1.5 pr-3 font-normal">{t("history.columns.period")}</th>
                      <th className="py-1.5 pr-3 font-normal">{t("history.columns.dates")}</th>
                      <th className="py-1.5 pr-3 text-right font-normal">
                        {t("history.columns.budget")}
                      </th>
                      <th className="py-1.5 pr-3 text-right font-normal">
                        {t("history.columns.booked")}
                      </th>
                      <th className="py-1.5 pr-3 text-right font-normal">
                        {t("history.columns.burn")}
                      </th>
                      <th className="py-1.5 font-normal">{t("history.columns.reference")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((p) => (
                      <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="py-1.5 pr-3 font-mono tabular-nums text-[var(--text-secondary)]">
                          {p.periodNo}
                        </td>
                        <td className="py-1.5 pr-3 font-mono tabular-nums text-[var(--text-secondary)]">
                          {t("history.dates", { startsOn: p.startsOn, endsOn: p.endsOn })}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-[var(--text-primary)]">
                          {t("history.hours", { hours: h(p.budgetHours) })}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-[var(--text-primary)]">
                          {t("history.hours", { hours: h(p.loggedHours) })}
                        </td>
                        <td
                          className="py-1.5 pr-3 text-right font-mono tabular-nums"
                          style={{ color: burnTone(p.burnPercent, p.warnAtPercent) }}
                        >
                          {p.burnPercent === null
                            ? tc("notAvailable")
                            : fmtPct(p.burnPercent, locale)}
                        </td>
                        <td className="py-1.5 text-[var(--text-faint)]">
                          {p.contractReference ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** The day after an ISO date, so a renewal defaults to starting cleanly. */
function nextDay(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return "";
  return new Date(t + 86_400_000).toISOString().slice(0, 10);
}
