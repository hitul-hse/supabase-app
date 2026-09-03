"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setBillableRate } from "./actions";
import type { BillableValueRow } from "@/lib/queries/types";
import { fmtInt, fmtNum } from "@/lib/locale-format";
import { Card } from "@/components/ui/Card";

/**
 * The rate a person's billable hours are valued at, and the value that follows.
 *
 * Both figures were printed with a hard-coded "de-DE", so the English page
 * showed German separators. They follow the request locale now, which is the
 * one place where the ENGLISH rendering of this panel changes.
 */
export function BillableRatePanel({
  personId,
  value,
  canEdit,
}: {
  personId: string;
  value: BillableValueRow | undefined;
  canEdit: boolean;
}) {
  const t = useTranslations("people.rates");
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rate = value?.billable_rate_eur;
  const hours = value?.billable_hours_logged ?? 0;
  const total = value?.billable_value_eur;

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await setBillableRate(formData);
    setPending(false);
    if (result.ok) {
      setEditing(false);
    } else {
      setError(result.message ?? t("error"));
    }
  }

  return (
    <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
            {t("label")}
          </span>
          {editing ? (
            <form action={handleSubmit} className="flex items-center gap-2">
              <input type="hidden" name="person_id" value={personId} />
              <input
                name="billable_rate_eur"
                type="number"
                min="0"
                step="1"
                defaultValue={rate ?? ""}
                disabled={pending}
                autoFocus
                placeholder={t("ratePlaceholder")}
                className="w-20 border border-[var(--border)] bg-[var(--page)] px-2 py-1 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={pending}
                className="bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {pending ? t("saving") : t("save")}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={pending}
                className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text-primary)]"
              >
                {t("cancel")}
              </button>
            </form>
          ) : (
            <span className="font-mono text-[22px] font-semibold text-[var(--text-primary)]">
              {rate != null ? t("amount", { amount: fmtInt(rate, locale) }) : "—"}
              <span className="text-[12px] font-normal text-[var(--text-muted)]">
                {" "}
                {t("perHour")}
              </span>
              {canEdit && (
                <button
                  onClick={() => setEditing(true)}
                  className="ml-2 align-middle text-[10px] font-normal text-[var(--text-faint)] hover:text-[var(--accent)]"
                >
                  {t("edit")}
                </button>
              )}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
            {t("valueLabel")}
          </span>
          <span className="font-mono text-[22px] font-semibold text-[var(--accent)]">
            {/* Three decimals is what the bare toLocaleString() here allowed,
                kept so only the separators move. */}
            {total != null ? t("amount", { amount: fmtNum(total, locale, 3) }) : "—"}
            <span className="text-[12px] font-normal text-[var(--text-muted)]">
              {" "}
              {t("perHours", { hours: fmtNum(hours, locale, 1) })}
            </span>
          </span>
        </div>
      </div>

      {error && <p className="text-[11px] text-[var(--critical)]">{error}</p>}
    </Card>
  );
}
