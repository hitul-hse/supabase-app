import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

/**
 * Locale WITHOUT i18n routing: URLs stay exactly as they are (no /en, /de
 * prefixes — links in the wild, bookmarks and the redirect allowlist all keep
 * working), and the language is a per-user preference carried in a cookie.
 *
 * "de" is a first-class citizen, not a translation afterthought: the
 * Management dashboard was German before this system existed, and its terms
 * (Auslastung, Vertragsstunden) are the canonical German — extracted into
 * messages/de.json, not retranslated.
 */
export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "hse-hub-locale";

export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  const locale: Locale = raw === "de" ? "de" : "en";
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
