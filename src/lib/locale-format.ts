/**
 * Numbers, hours and dates in the reader's language.
 *
 * WHY THIS EXISTS
 * ---------------
 * /time/dashboard, /projects and /people formatted every figure with a
 * hard-coded `toLocaleString("en-GB")`, so the German page printed "5,638.4h"
 * and "3 Sept" — English digits under German words. The strings moved into the
 * catalogue; the digits between them have to move too, or the translation is
 * only half done.
 *
 * WHY NOT admin/system-health/format.ts. That module pins en-GB in BOTH
 * languages on purpose: src/lib/health-score.ts bakes en-GB into its `detail`
 * sentences and the drill-downs print those verbatim, so a figure and its drill
 * must not disagree on the thousands separator. That reasoning is specific to a
 * diagnostics page reading pg_catalog. These three pages have no such baked
 * strings, so they follow the request locale instead — which is what the reader
 * asked for by pressing the toggle.
 *
 * WHY NOT de-DE in both, as Management does. Management is German-first: it was
 * a German page before the locale system existed and its digits were always
 * de-DE. These pages were English-first and their English rendering must not
 * move (translation extraction is a refactor, not a redesign), so en keeps
 * en-GB exactly as before and only de changes.
 *
 * No React here, so a Server Component and a "use client" panel can both import
 * it. Callers get the locale from getLocale() on the server or useLocale() in a
 * client component.
 */
import type { Locale } from "@/i18n/request";

/** BCP 47 tag per app locale, for every Intl constructor in these pages. */
export const LOCALE_TAG: Record<Locale, string> = { en: "en-GB", de: "de-DE" };

export function tagFor(locale: string | undefined): string {
  return LOCALE_TAG[(locale === "de" ? "de" : "en") as Locale];
}

/** A whole number with thousands separators: "5,638" (de: "5.638"). */
export function fmtInt(n: number, locale: string | undefined): string {
  return Math.round(n).toLocaleString(tagFor(locale));
}

/** A number to `dp` decimals: "5,638.4" (de: "5.638,4"). */
export function fmtNum(n: number, locale: string | undefined, dp = 1): string {
  return n.toLocaleString(tagFor(locale), { maximumFractionDigits: dp });
}

/**
 * Hours with the unit attached: "5,638.4h" (de: "5.638,4 h").
 *
 * German gets a space before the unit but keeps "h", NOT "Std". That is the
 * catalogue's existing canon — overview.billableSplit.legendBillable reads
 * "{hours} h abrechenbar" and management.values.hours reads "{hours} h" — and
 * a second abbreviation for the same unit would read as a second unit. (The
 * "Std" in admin/system-health/format.ts belongs to a different scale, where it
 * contrasts with Min and Tg to size a duration; nothing here needs that.)
 */
export function fmtHours(h: number, locale: string | undefined, dp = 1): string {
  const n = h.toLocaleString(tagFor(locale), { maximumFractionDigits: dp });
  return locale === "de" ? `${n} h` : `${n}h`;
}

/** A bare hours figure with no unit, for a tile whose unit is drawn separately. */
export function fmtHoursBare(h: number, locale: string | undefined, dp = 1): string {
  return h.toLocaleString(tagFor(locale), { maximumFractionDigits: dp });
}

/** An integer percentage: "76%" (de: "76 %", the German typographic convention). */
export function fmtPct(n: number, locale: string | undefined, dp = 0): string {
  const v = n.toLocaleString(tagFor(locale), { maximumFractionDigits: dp });
  return locale === "de" ? `${v} %` : `${v}%`;
}

/** A date in the reader's language: "3 Sept" (de: "3. Sept."). */
export function fmtDate(
  d: Date | string,
  locale: string | undefined,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string {
  const t = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(t.getTime())) return typeof d === "string" ? d : "";
  return t.toLocaleDateString(tagFor(locale), opts);
}

/** A date and time: "3 Sept, 07:37" (de: "3. Sept., 07:37"). */
export function fmtDateTime(d: Date | string, locale: string | undefined): string {
  const t = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(t.getTime())) return typeof d === "string" ? d : "";
  const day = t.toLocaleDateString(tagFor(locale), { day: "numeric", month: "short" });
  const hm = t.toLocaleTimeString(tagFor(locale), { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${hm}`;
}
