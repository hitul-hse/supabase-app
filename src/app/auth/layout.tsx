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
 * `MotionProvider` is here for the same reason. It is the single
 * `<MotionConfig reducedMotion="user">` that makes framer-motion honour the
 * operating system's setting — framer's default is "never" — so without it the
 * sign-in entrance and the language menu would keep animating at full
 * amplitude for someone who has asked the OS for less. Under it, transforms
 * become instant and only the opacity cross-fade survives: movement removed,
 * not merely shortened (APPLE_REF §6.1).
 *
 * Both are cheap: the messages are already loaded per request by the request
 * config, and MotionConfig renders no DOM.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={messages}>
      <MotionProvider>{children}</MotionProvider>
    </NextIntlClientProvider>
  );
}
