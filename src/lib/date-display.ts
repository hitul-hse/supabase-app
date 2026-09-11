/**
 * The three date helpers every surface that shows a sheet date needs, in one
 * place so two pages cannot disagree about what day it is.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `MyWorkDetail.tsx` grew all three of these inline, and each one encodes a bug
 * that was paid for once already:
 *
 *  - `formatDate` parses a DATE-ONLY string as UTC midnight AND formats it in
 *    UTC. `new Date("2026-12-31")` is already UTC midnight, but
 *    `toLocaleDateString` without `timeZone` renders it in the VIEWER's zone,
 *    so everyone west of Greenwich reads the 31st as the 30th. A contract end
 *    date that moves by a day depending on who is looking is not a date.
 *
 *  - `formatStamp` pins Europe/Berlin rather than the viewer's zone, so a
 *    server render and a client render of the same instant produce the same
 *    string. Anything else is a hydration mismatch that flashes the footnote.
 *
 *  - `todayInBerlin` is `en-CA` in Europe/Berlin, never
 *    `toISOString().slice(0, 10)`. The UTC date is still YESTERDAY in Berlin
 *    between local midnight and 01:00 (02:00 in summer) — long enough for the
 *    server and the client to disagree about whether a contract has ended.
 *
 * NO IMPORTS, ON PURPOSE. This module is pulled into the query layer (which
 * gates load directly under `node --experimental-strip-types`, with no bundler)
 * as well as into components. A single `next/*` import here would break those
 * gates with ERR_MODULE_NOT_FOUND — the failure budget-visibility.ts documents.
 *
 * MyWorkDetail.tsx is deliberately NOT migrated onto this module in the same
 * change: it is pinned by check-my-work-detail.mjs and owned by other work in
 * flight. Its three copies are byte-identical to these; folding them in is a
 * follow-up, not a drive-by.
 */

/** The locale tag the app formats in, from the two-letter UI locale. */
function intlLocale(locale: string): string {
  return locale === "de" ? "de-DE" : "en-GB";
}

/**
 * A date-only ISO string (`YYYY-MM-DD`) in the reader's locale.
 *
 * Parsed as UTC midnight and formatted in UTC, so `2026-12-31` is the 31st on
 * every machine. An unparseable value is returned as written rather than
 * rendered as "Invalid Date".
 */
export function formatDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A timestamp in the company's zone.
 *
 * Pinned to Europe/Berlin rather than the viewer's zone so the server render
 * and the client render agree, and because every stamp this app shows is a
 * Berlin office time in the first place.
 */
export function formatStamp(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

/**
 * Today as `YYYY-MM-DD` in Europe/Berlin.
 *
 * en-CA is the locale whose default date format IS the ISO one, so this needs
 * no string surgery. Compared against a stored `date` column as a STRING, which
 * sorts as a date: a contract ending today is still running today.
 */
export function todayInBerlin(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}
