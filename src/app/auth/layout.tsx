import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { MotionProvider } from "@/components/animations/MotionProvider";

/**
 * The unauthenticated segment's provider shell.
 *
 * Until now next-intl lived only under `(app)`, so nothing before sign-in could
 * read a message or the active locale — which is why the language control could
 * not be offered on the one screen where a German speaker is most likely to
 * need it: the one they are stuck on. The provider is the SAME mechanism the
 * app shell uses (cookie locale, no URL routing, `src/i18n/request.ts`); this
 * only widens where it is mounted.
 *
 * ONLY `common.language` CROSSES, NOT THE CATALOGUE.
 *
 * `NextIntlClientProvider` serialises whatever it is handed into the HTML, and
 * the first version of this file handed it `getMessages()` — all of it. That
 * shipped every string in the product to anyone who loaded the sign-in page
 * without an account: admin nouns, management vocabulary, table headings, the
 * whole feature surface, on the one page that should be the lightest thing we
 * serve. check-auth-gates caught it as `/auth/login -> 200 LEAKS RECORD DATA`,
 * because "Users & Roles" and "Utilisation by person" — two of its sentinels
 * for authenticated content — are message keys, and it was right to: those
 * words genuinely were in the response body of a public page.
 *
 * The unauthenticated pages read exactly one namespace, so exactly one crosses.
 * A page here that needs another must add it deliberately, which is the point.
 *
 * `MotionProvider` is here for a different reason. It is the single
 * `<MotionConfig reducedMotion="user">` that makes framer-motion honour the
 * operating system's setting — framer's default is "never" — so without it the
 * sign-in entrance and the language menu would keep animating at full
 * amplitude for someone who has asked the OS for less. Under it, transforms
 * become instant and only the opacity cross-fade survives: movement removed,
 * not merely shortened (APPLE_REF §6.1). It renders no DOM.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={{ common: { language: messages.common.language } }}>
      <MotionProvider>{children}</MotionProvider>
    </NextIntlClientProvider>
  );
}
