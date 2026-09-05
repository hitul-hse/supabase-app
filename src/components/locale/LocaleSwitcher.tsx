"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "./locale-action";

/**
 * EN ⇄ DE, one press. The label always names the language you would SWITCH TO,
 * written in that language — a German speaker lost in the English UI must be
 * able to find their way home without reading English.
 *
 * A 32 px control like the rest of the top bar (APPLE_REF §3.2 `md`), 44 px
 * on coarse pointers; it measured 31 × 25 before, under the desktop floor of
 * 28 and well under the touch minimum. `t-label` is the two-letter code's
 * role (mono 10/13, 500, +0.08em).
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
      className="inline-flex h-8 min-w-8 flex-none items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 t-label text-[var(--text-secondary)] transition-[color,background-color,border-color,transform] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:translate-y-px disabled:opacity-60 pointer-coarse:h-11 pointer-coarse:min-w-11"
    >
      {locale === "de" ? "EN" : "DE"}
    </button>
  );
}
