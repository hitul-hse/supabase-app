"use client";

/**
 * Route-level error boundary for the app shell.
 *
 * Without this, a failed query inside any (app) page falls through to the
 * framework's default error screen, which shows a stack trace in dev and a
 * blank page in production. A data-tool that silently blanks a page is worse
 * than one that says what happened and offers a way forward.
 *
 * The two actions are the house Button and ButtonLink -- the same primary /
 * secondary pair every form uses -- and the words come from the catalogue, so
 * a German reader's error page is German. It renders inside the layout's
 * NextIntlClientProvider, which is what makes the hook available here. No
 * "HSE HUB" eyebrow above the title: the craft floor bans the kicker, and the
 * sidebar beside this already says whose product it is.
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui/Button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common.error");

  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
          {t("title")}
        </h1>
        <p className="max-w-[52ch] text-[12px] leading-relaxed text-[var(--text-muted)]">
          {t("description")}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={reset}>
          {t("tryAgain")}
        </Button>
        <ButtonLink href="/" variant="secondary">
          {t("backToOverview")}
        </ButtonLink>
      </div>

      {error.digest && (
        <span className="font-mono text-[10px] text-[var(--text-faint)]">
          {t("ref", { digest: error.digest })}
        </span>
      )}
    </div>
  );
}
