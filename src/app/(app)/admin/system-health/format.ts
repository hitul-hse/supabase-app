/**
 * Formatting shared by the server view model and the client panels.
 *
 * en-GB digits on purpose, in both languages: src/lib/health-score.ts writes
 * its component `detail` sentences with en-GB formatting and the drill-downs
 * print those verbatim, so a figure on the page and the same figure in its
 * drill must not disagree on the thousands separator. This is a developer
 * page reading pg_catalog; the numbers are diagnostics, not prose.
 *
 * LOCALE. Dates and durations are read as prose, so those two take the
 * page's locale (page.tsx passes getLocale(); a panel passes useLocale()).
 * Everything else stays en-GB for the reason above. A caller that passes no
 * locale gets en-GB, so drills.ts keeps agreeing with health-score.ts.
 *
 * No React here, so both a server component and a "use client" panel can
 * import it without dragging the other side's runtime along.
 */
import type { Locale } from "@/i18n/request";

const nf = new Intl.NumberFormat("en-GB");

/** BCP 47 tag per app locale, for Intl. */
const TAG: Record<Locale, string> = { en: "en-GB", de: "de-DE" };

/** Duration unit words; German abbreviates to Min / Std / Tg. */
const HOUR_UNITS: Record<Locale, { min: string; h: string; d: string }> = {
  en: { min: "min", h: "h", d: "d" },
  de: { min: "Min", h: "Std", d: "Tg" },
};

export function fmtInt(n: number): string {
  return nf.format(Math.round(n));
}

export function fmt1(n: number): string {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

/** Hours as a human size: "42 min", "3.2 h", "1.3 d" (de: "42 Min", "3,2 Std", "1,3 Tg"). */
export function fmtHours(h: number, locale: Locale = "en"): string {
  const u = HOUR_UNITS[locale];
  const one = (n: number) => n.toLocaleString(TAG[locale], { maximumFractionDigits: 1 });
  if (h < 1) return `${Math.max(0, Math.round(h * 60))} ${u.min}`;
  if (h < 48) return `${one(h)} ${u.h}`;
  return `${one(h / 24)} ${u.d}`;
}

export function fmtBytes(b: number): string {
  const abs = Math.abs(b);
  if (abs >= 1024 ** 3) return `${fmt1(b / 1024 ** 3)} GB`;
  if (abs >= 1024 ** 2) return `${fmt1(b / 1024 ** 2)} MB`;
  if (abs >= 1024) return `${fmtInt(b / 1024)} kB`;
  return `${fmtInt(b)} B`;
}

/** Milliseconds as a duration: "812 ms", "41.2 s", "3.4 min". */
export function fmtMs(ms: number): string {
  if (ms < 10_000) return `${fmtInt(ms)} ms`;
  if (ms < 600_000) return `${fmt1(ms / 1000)} s`;
  return `${fmt1(ms / 60_000)} min`;
}

export function fmtPct(n: number, dp = 0): string {
  return `${n.toLocaleString("en-GB", { maximumFractionDigits: dp })} %`;
}

/** "02 Sep 04:17Z" (de: "02. Sept. 04:17Z") from an ISO or Postgres text timestamp; the ISO form goes in a title. */
export function fmtTime(iso: string, locale: Locale = "en"): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const d = t.toLocaleDateString(TAG[locale], { day: "2-digit", month: "short", timeZone: "UTC" });
  const hm = t.toLocaleTimeString(TAG[locale], { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${d} ${hm}Z`;
}

/** A day tick on the timeline axis: "3 Aug" (de: "3. Aug."). */
export function fmtDay(d: Date, locale: Locale = "en"): string {
  return d.toLocaleDateString(TAG[locale], { day: "numeric", month: "short", timeZone: "UTC" });
}

export function toIso(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toISOString();
}

export function hoursBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;
}
