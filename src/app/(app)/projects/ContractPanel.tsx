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
import type { ContractPeriodRow } from "@/lib/queries/contract-periods";
import {
  setContractTerms,
  renewContract,
  correctContractPeriod,
  type ContractActionResult,
} from "./contract-actions";

const LABEL =
  "block font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-muted)]";
const FIELD =
  "w-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] disabled:opacity-50";
const BUTTON =
  "border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-50";

function h(n: number): string {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

/** Burn colour, matching the thresholds used elsewhere in the app. */
function burnTone(percent: number | null, warnAt: number): string {
  if (percent === null) return "var(--text-secondary)";
  if (percent > 100) return "var(--critical)";
  if (percent >= warnAt) return "var(--warning, #d99b3d)";
  return "var(--accent)";
}

/** A proportional bar. Over 100% it stays full and turns critical. */
function BurnBar({ percent, warnAt }: { percent: number | null; warnAt: number }) {
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div
      className="h-1.5 w-full bg-[var(--surface-2)]"
      role="img"
      aria-label={percent === null ? "No budget set" : `${percent.toFixed(0)} percent of budget used`}
    >
      <div
        className="h-full transition-[width]"
        style={{ width: `${clamped}%`, backgroundColor: burnTone(percent, warnAt) }}
      />
    </div>
  );
}

function Feedback({ result }: { result: ContractActionResult | null }) {
  if (!result?.message) return null;
  return (
    <p
      className="mt-2 text-[11.5px] leading-relaxed"
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
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className={LABEL} htmlFor="budget_hours">
          Agreed hours
        </label>
        <input
          id="budget_hours"
          name="budget_hours"
          type="text"
          inputMode="decimal"
          required
          disabled={disabled}
          defaultValue={defaults?.budgetHours ?? ""}
          placeholder="e.g. 8"
          className={FIELD}
        />
      </div>
      <div>
        <label className={LABEL} htmlFor="starts_on">
          Contract starts
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
          Contract ends
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
          Contract reference
        </label>
        <input
          id="contract_reference"
          name="contract_reference"
          type="text"
          disabled={disabled}
          defaultValue={defaults?.contractReference ?? ""}
          placeholder="optional"
          className={FIELD}
        />
      </div>
      <div>
        <label className={LABEL} htmlFor="warn_at_percent">
          Warn at %
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
        <p className="mt-1 text-[10.5px] leading-snug text-[var(--text-faint)]">
          Bookings warn from here on. A small retainer and a large programme
          rarely want the same point.
        </p>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={LABEL} htmlFor="notes">
          Notes
        </label>
        <input
          id="notes"
          name="notes"
          type="text"
          disabled={disabled}
          defaultValue={defaults?.notes ?? ""}
          placeholder="optional"
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
}) {
  const [result, setResult] = useState<ContractActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [renewing, setRenewing] = useState(false);
  const [correcting, setCorrecting] = useState<number | null>(null);

  const current = periods.find((p) => p.isCurrent) ?? null;
  const latest = periods[0] ?? null;
  const history = periods.filter((p) => p.id !== current?.id);

  const run = (fn: () => Promise<ContractActionResult>) =>
    startTransition(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        setRenewing(false);
        setCorrecting(null);
      }
    });

  return (
    <section className="border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
            Contract
          </h2>
          <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">
            The hours sales agreed, and the dates they cover. Renewing keeps
            every previous period on record.
          </p>
        </div>
        {canWrite && periods.length > 0 && !renewing && (
          <button
            type="button"
            onClick={() => {
              setRenewing(true);
              setResult(null);
            }}
            className={`${BUTTON} border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10`}
          >
            Renew contract
          </button>
        )}
      </header>

      {/* ------------------------------------------------- no contract yet */}
      {periods.length === 0 && (
        <div className="px-4 py-4">
          <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
            No contract terms recorded for this project.
            {fallbackEstimateHours !== null && fallbackEstimateHours > 0 ? (
              <>
                {" "}
                The budget guard is falling back to the{" "}
                <strong className="text-[var(--text-primary)]">
                  {h(fallbackEstimateHours)}h
                </strong>{" "}
                estimate synced from TrackingTime, which the vendor overwrites on
                every sync. Record the agreed terms to make the budget stick.
              </>
            ) : (
              " There is no budget to enforce, so bookings on it are never refused."
            )}
          </p>

          {!featureInstalled ? (
            <div className="mt-4 flex flex-col gap-2 border-t border-[var(--border)] pt-4">
              <p className="text-[12px] leading-relaxed text-[var(--text-primary)]">
                Contract terms are not switched on in the database yet, so nobody can
                record them -- including executives. This is not a permission problem.
              </p>
              <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
                Apply{" "}
                <code className="font-mono text-[11px] text-[var(--text-primary)]">
                  supabase/migrations/add_contract_periods.sql
                </code>{" "}
                and then{" "}
                <code className="font-mono text-[11px] text-[var(--text-primary)]">
                  supabase/migrations/add_budget_alert_visibility.sql
                </code>
                , and this panel becomes editable.
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
                  className={`${BUTTON} border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10`}
                >
                  {pending ? "Recording..." : "Record contract terms"}
                </button>
              </div>
            </form>
          ) : (
            <p className="mt-2 text-[11px] text-[var(--text-faint)]">
              Contract terms are commercial, so only executives and department
              heads can record them.
            </p>
          )}
          <Feedback result={result} />
        </div>
      )}

      {/* ------------------------------------------------- the current term */}
      {periods.length > 0 && (
        <div className="px-4 py-4">
          {current === null && latest !== null && (
            <p className="mb-4 border border-[var(--critical)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--critical)]">
              No contract covers today. Period {latest.periodNo} ended on{" "}
              {latest.endsOn}. Hours logged since then sit outside any contract
              period: they are still recorded, but they cannot be checked against
              a budget until the renewal is confirmed.
            </p>
          )}

          {current !== null && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                  Period {current.periodNo}
                  {current.contractReference ? ` · ${current.contractReference}` : ""}
                </span>
                <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                  {current.startsOn} to {current.endsOn}
                  {current.daysRemaining >= 0
                    ? ` · ${current.daysRemaining} days left`
                    : " · ended"}
                </span>
              </div>

              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span
                  className="font-mono text-[24px] font-semibold tracking-[-0.02em]"
                  style={{ color: burnTone(current.burnPercent, current.warnAtPercent) }}
                >
                  {h(current.loggedHours)} / {h(current.budgetHours)} h
                </span>
                <span
                  className="font-mono text-[13px]"
                  style={{ color: burnTone(current.burnPercent, current.warnAtPercent) }}
                >
                  {current.burnPercent === null ? "n/a" : `${current.burnPercent}%`}
                </span>
                <span className="text-[11.5px] text-[var(--text-secondary)]">
                  {current.remainingHours >= 0
                    ? `${h(current.remainingHours)}h remaining`
                    : `${h(Math.abs(current.remainingHours))}h over the agreed budget`}
                </span>
              </div>

              <BurnBar percent={current.burnPercent} warnAt={current.warnAtPercent} />

              <p className="text-[11px] text-[var(--text-faint)]">
                Bookings warn from {current.warnAtPercent}% and are refused past
                100%. Only hours dated inside this period count towards it.
              </p>

              {canWrite && correcting !== current.id && (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setCorrecting(current.id);
                      setResult(null);
                    }}
                    className={`${BUTTON} border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text-primary)]`}
                  >
                    Correct these terms
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
              <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
                Record the renewed terms once sales confirm them. This adds a new
                period; period {latest?.periodNo ?? 1} keeps its own budget and
                the hours already booked against it. The new period must not
                overlap the old one, so it usually starts the day after it ended.
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
                  className={`${BUTTON} border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10`}
                >
                  {pending ? "Renewing..." : "Confirm renewal"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setRenewing(false)}
                  className={`${BUTTON} border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text-primary)]`}
                >
                  Cancel
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
              <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
                Correcting a period changes its terms without touching the hours
                booked against it. Use this for a transcription error, not for a
                renewal.
              </p>
              <TermFields
                disabled={pending}
                defaults={periods.find((p) => p.id === correcting)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={pending}
                  className={`${BUTTON} border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10`}
                >
                  {pending ? "Saving..." : "Save correction"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setCorrecting(null)}
                  className={`${BUTTON} border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text-primary)]`}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <Feedback result={result} />

          {/* --------------------------------------------------- history */}
          {history.length > 0 && (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                Contract history
              </h3>
              <p className="mt-0.5 mb-2 text-[11px] text-[var(--text-faint)]">
                Every previous term keeps its own budget and its own booked
                hours. Nothing is overwritten by a renewal.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[11.5px]">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                      <th className="py-1.5 pr-3 font-normal">Period</th>
                      <th className="py-1.5 pr-3 font-normal">Dates</th>
                      <th className="py-1.5 pr-3 text-right font-normal">Budget</th>
                      <th className="py-1.5 pr-3 text-right font-normal">Booked</th>
                      <th className="py-1.5 pr-3 text-right font-normal">Burn</th>
                      <th className="py-1.5 font-normal">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((p) => (
                      <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="py-1.5 pr-3 font-mono tabular-nums text-[var(--text-secondary)]">
                          {p.periodNo}
                        </td>
                        <td className="py-1.5 pr-3 font-mono tabular-nums text-[var(--text-secondary)]">
                          {p.startsOn} to {p.endsOn}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-[var(--text-primary)]">
                          {h(p.budgetHours)} h
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-[var(--text-primary)]">
                          {h(p.loggedHours)} h
                        </td>
                        <td
                          className="py-1.5 pr-3 text-right font-mono tabular-nums"
                          style={{ color: burnTone(p.burnPercent, p.warnAtPercent) }}
                        >
                          {p.burnPercent === null ? "n/a" : `${p.burnPercent}%`}
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
    </section>
  );
}

/** The day after an ISO date, so a renewal defaults to starting cleanly. */
function nextDay(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return "";
  return new Date(t + 86_400_000).toISOString().slice(0, 10);
}
