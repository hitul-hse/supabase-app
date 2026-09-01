"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "./locale-action";

/**
 * EN ⇄ DE, one press. The label always names the language you would SWITCH TO,
 * written in that language — a German speaker lost in the English UI must be
 * able to find their way home without reading English.
 */
export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const next = locale === "de" ? "en" : "de";

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => setLocale(next))}
      aria-label={t("switchLanguage")}
      className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-60"
    >
      {locale === "de" ? "EN" : "DE"}
    </button>
  );
}
