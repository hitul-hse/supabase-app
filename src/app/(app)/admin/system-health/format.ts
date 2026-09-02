/**
 * Formatting shared by the server view model and the client panels.
 *
 * en-GB digits on purpose, in both languages: src/lib/health-score.ts writes
 * its component `detail` sentences with en-GB formatting and the drill-downs
 * print those verbatim, so a figure on the page and the same figure in its
 * drill must not disagree on the thousands separator. This is a developer
 * page reading pg_catalog; the numbers are diagnostics, not prose.
 *
 * No React here, so both a server component and a "use client" panel can
 * import it without dragging the other side's runtime along.
 */

const nf = new Intl.NumberFormat("en-GB");

export function fmtInt(n: number): string {
  return nf.format(Math.round(n));
}

export function fmt1(n: number): string {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

/** Hours as a human size: "42 min", "3.2 h", "1.3 d". */
export function fmtHours(h: number): string {
  if (h < 1) return `${Math.max(0, Math.round(h * 60))} min`;
  if (h < 48) return `${fmt1(h)} h`;
  return `${fmt1(h / 24)} d`;
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

/** "02 Sep 04:17Z" from an ISO or Postgres text timestamp; the ISO form goes in a title. */
export function fmtTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const d = t.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  const hm = t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${d} ${hm}Z`;
}

export function toIso(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toISOString();
}

export function hoursBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;
}
