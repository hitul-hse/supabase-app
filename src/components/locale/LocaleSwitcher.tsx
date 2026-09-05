"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "./locale-action";
import { menuItemClass } from "../ui/Menu";

/**
 * EN ⇄ DE, one press. The label always names the language you would SWITCH TO,
 * written in that language — a German speaker lost in the English UI must be
 * able to find their way home without reading English.
 *
 * A 32 px control like the rest of the top bar (APPLE_REF §3.2 `md`), 44 px
 * on coarse pointers; it measured 31 × 25 before, under the desktop floor of
 * 28 and well under the touch minimum. `t-label` is the two-letter code's
 * role (mono 10/13, 500, +0.08em).
 *
 * TWO SHAPES (APPLE_REF §3.1, HIG/toolbars: secondary controls collapse into
 * an overflow on a narrow window). `bar` is the round button above, shown
 * from `sm` up; `menuitem` is the same action as a row of the account menu,
 * which `UserMenu` renders only below `sm` -- so the control exists once at
 * any width and a 390 px title row is not spent on it.
 */

/** A globe in nav-icons' 1.5px stroke voice, for the menu row. */
function IconGlobe({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden className={className}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M1.75 8h12.5M8 1.75c1.9 1.7 2.85 3.8 2.85 6.25S9.9 12.55 8 14.25M8 1.75C6.1 3.45 5.15 5.55 5.15 8S6.1 12.55 8 14.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LocaleSwitcher({
  variant = "bar",
  onActivate,
}: {
  variant?: "bar" | "menuitem";
  /** `menuitem` only: called on the press, so the menu can close and return focus. */
  onActivate?: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const next = locale === "de" ? "en" : "de";

  if (variant === "menuitem") {
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        disabled={pending}
        onClick={() => {
          onActivate?.();
          startTransition(() => setLocale(next));
        }}
        data-testid="menu-language"
        className={menuItemClass}
      >
        <IconGlobe className="flex-none text-[var(--text-secondary)]" />
        {t("switchLanguage")}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => setLocale(next))}
      aria-label={t("switchLanguage")}
      data-testid="locale-switcher"
      // `hidden` below `sm`: the phone's overflow is the menu item above.
      className="hidden h-8 min-w-8 flex-none items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 t-label text-[var(--text-secondary)] transition-[color,background-color,border-color,transform] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:translate-y-px disabled:opacity-60 sm:inline-flex pointer-coarse:h-11 pointer-coarse:min-w-11"
    >
      {locale === "de" ? "EN" : "DE"}
    </button>
  );
}
