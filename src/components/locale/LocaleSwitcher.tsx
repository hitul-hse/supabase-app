"use client";

/**
 * LocaleSwitcher — the language picker.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * This used to be a two-state toggle whose label named the language you would
 * switch TO: standing in the English UI it read "DE", and the account menu row
 * read "Sprache: Deutsch". Users read a control's label as a description of the
 * current state, not of the state one press away, so the English app looked
 * like the German one — reported verbatim as "when i am in English version and
 * the language shows German". A toggle also cannot say what the alternatives
 * are, which is the other half of the complaint.
 *
 * It is now a MENU (APPLE_REF §5.8 "Popover / menu"): the trigger states the
 * language you are in, and pressing it lists every language with the current
 * one marked. Two entries is small for a menu, but the toggle's ambiguity is
 * not fixable at two entries either — the label has to name either the state
 * or the action, and it cannot do both.
 *
 * ENDONYMS, NOT TRANSLATIONS. "English" and "Deutsch" are written in their own
 * language and are the same in every locale, so a German speaker stranded in
 * the English UI can find their way home without reading English. That is why
 * the language names are a constant here and not message keys — a translated
 * language list is exactly the thing a lost user cannot read.
 *
 * TWO SHAPES (APPLE_REF §3.1, HIG/toolbars: secondary controls collapse into an
 * overflow on a narrow window). `bar` is the button-plus-menu above, shown from
 * `sm` up and on the sign-in page; `menuitem` is the same choice flattened into
 * rows of the account menu, which `UserMenu` renders only below `sm` — so the
 * control exists once at any width and a 390 px title row is not spent on it.
 * The rows are flattened rather than opening a second menu because a menu
 * inside a menu is banned (§5.8 "one at a time, never nested").
 *
 * MOTION (APPLE_REF §6.2 "Popover / menu"): the panel scales .96 → 1 with
 * opacity on SPRING_POPOVER (response 0.28, critically damped) from a
 * transform-origin at the trigger, so it grows out of the thing that opened it,
 * and leaves along the same path in a 120 ms fade. The exit is carried by
 * AnimatePresence and the portal is rendered by a component that can ask
 * `useIsPresent()`, so a menu on its way out is neither a target nor a tab stop
 * and the closing animation is allowed to finish instead of being cut off.
 * Reduce Motion snaps the scale and keeps the cross-fade, via the
 * `<MotionConfig reducedMotion="user">` in the shell each surface mounts under
 * (MotionProvider) — movement is removed, not merely shortened.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { setLocale } from "./locale-action";
import { MenuCheck, menuItemClass, menuPanelClass } from "../ui/Menu";
import { EASE_OUT, SPRING_POPOVER } from "../animations/springs";

/**
 * Every language the app ships, named in itself. Order is fixed (not
 * current-first): a list that reorders under the cursor makes the second press
 * land on the wrong row.
 */
const LANGUAGES = [
  { code: "en", endonym: "English" },
  { code: "de", endonym: "Deutsch" },
] as const;

/** A globe in nav-icons' 1.5px stroke voice. */
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

/** A chevron that points the way the panel will open. */
function IconChevron({ up }: { up: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      aria-hidden
      className="flex-none opacity-70"
      style={{ transform: up ? "rotate(180deg)" : undefined }}
    >
      <path d="M4.5 6.5 8 10l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 8 px between the trigger and the panel (§5.8: no arrow needed at this offset). */
const GAP = 8;
/**
 * Enough room for two 44 px rows plus the panel's 4 px inset, which is the tall
 * (coarse-pointer) case. Used only to decide whether the panel opens up or
 * down; when it opens up it is anchored by its BOTTOM edge, so an inexact
 * estimate cannot misplace it.
 */
const EST_PANEL_H = 2 * 44 + 8;

/**
 * The portal, rendered by a component so it can be an AnimatePresence child (a
 * bare `createPortal()` return value is not a React element and AnimatePresence
 * would not track it) and so the panel can read its own presence.
 */
function PortalPanel({ children }: { children: (present: boolean) => ReactNode }) {
  const present = useIsPresent();
  return createPortal(children(present), document.body);
}

type Placement = { up: boolean; right: number; top?: number; bottom?: number };

export function LocaleSwitcher({
  variant = "bar",
  hideOnPhone = true,
  onActivate,
}: {
  variant?: "bar" | "menuitem";
  /**
   * `bar` only. In the TOP BAR the control is hidden below `sm`, because the
   * account menu renders the `menuitem` rows there instead and the 390 px title
   * row cannot spare a second control (see the note on the two shapes above) —
   * so this defaults to true and `TopBarChrome` needs no argument.
   *
   * The SIGN-IN page passes false: there is no account menu before you are
   * signed in, so hiding it on a phone would leave a German speaker with no way
   * at all to change the language of the screen they are stuck on.
   */
  hideOnPhone?: boolean;
  /** `menuitem` only: called on the press, so the account menu can close and return focus. */
  onActivate?: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("common.language");
  const [pending, startTransition] = useTransition();

  const current = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[0];

  const choose = useCallback(
    (code: string) => {
      if (code === locale) return;
      startTransition(() => setLocale(code));
    },
    [locale],
  );

  // ── Flattened rows, for the account menu's phone overflow ────────────────
  //
  // `role="menuitem"`, not `menuitemradio`, and `aria-current` rather than
  // `aria-checked`: UserMenu owns the arrow-key navigation of the menu these
  // rows join and finds its items with a `[role="menuitem"]` query, so a radio
  // role here would silently drop the language rows out of keyboard
  // navigation. `aria-current` is a valid marker on any element and carries
  // the same fact. The panel below, whose keyboard handling this file owns,
  // uses the stronger `menuitemradio` semantics.
  if (variant === "menuitem") {
    return (
      <>
        {LANGUAGES.map((lang) => {
          const isCurrent = lang.code === current.code;
          return (
            <button
              key={lang.code}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-current={isCurrent ? "true" : undefined}
              disabled={pending}
              onClick={() => {
                onActivate?.();
                choose(lang.code);
              }}
              data-testid={`menu-language-${lang.code}`}
              className={menuItemClass}
            >
              <MenuCheck checked={isCurrent} />
              {lang.endonym}
            </button>
          );
        })}
      </>
    );
  }

  return (
    <LocaleMenuButton
      current={current}
      choose={choose}
      pending={pending}
      hideOnPhone={hideOnPhone}
      t={t}
    />
  );
}

function LocaleMenuButton({
  current,
  choose,
  pending,
  hideOnPhone,
  t,
}: {
  current: (typeof LANGUAGES)[number];
  choose: (code: string) => void;
  pending: boolean;
  hideOnPhone: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Placement | null>(null);
  const [initialFocus, setInitialFocus] = useState<"current" | "first" | "last">("current");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  /**
   * Where the panel sits, measured from the trigger. Right-aligned to it and
   * clamped inside the viewport; flips ABOVE when there is no room below — on
   * the sign-in page this control lives in the footer row, where "below" is
   * off-screen. Opening upward is anchored by the panel's own bottom edge, so
   * EST_PANEL_H only has to be good enough to choose a direction.
   */
  const measure = useCallback((): Placement | null => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return null;
    const up = r.bottom + GAP + EST_PANEL_H > window.innerHeight;
    return {
      up,
      right: Math.max(GAP, window.innerWidth - r.right),
      ...(up ? { bottom: Math.max(GAP, window.innerHeight - r.top + GAP) } : { top: r.bottom + GAP }),
    };
  }, []);

  const openMenu = useCallback(
    (focus: "current" | "first" | "last") => {
      const p = measure();
      if (!p) return;
      setPlace(p);
      setInitialFocus(focus);
      setOpen(true);
    },
    [measure],
  );

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);

  // Open ON the current language: a menu of two should land the caret on the
  // row that describes where you are, not always on the first one.
  useEffect(() => {
    if (!open) return;
    const all = items();
    if (!all.length) return;
    const currentIndex = all.findIndex((el) => el.getAttribute("aria-checked") === "true");
    const target =
      initialFocus === "last"
        ? all[all.length - 1]
        : initialFocus === "current" && currentIndex >= 0
          ? all[currentIndex]
          : all[0];
    // `preventScroll`, and it is not cosmetic. The panel is `position: fixed`
    // and already fully in view, so scrolling to it is never needed — but on a
    // page taller than the viewport the browser scrolled anyway, that scroll
    // reached the `close-on-scroll` listener below, and the menu shut itself
    // in the same frame it opened. Measured at 390 x 844 on this page, where
    // the trigger sits in the footer row: the menu never appeared at all.
    target.focus({ preventScroll: true });
  }, [open, initialFocus]);

  // Outside click, Escape from anywhere, and scroll — a fixed panel under an
  // in-flow trigger would otherwise drift away from it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    /*
     * The panel is `position: fixed` under an IN-FLOW trigger, so a scroll
     * moves one and not the other. It RE-MEASURES rather than closing, and
     * closes only once the trigger has left the window entirely — there is
     * nothing to anchor to then.
     *
     * Closing on any scroll was the first version and it was wrong twice over.
     * Pressing a `<button>` focuses it, and the browser scrolls a focused
     * element into view; on a page one screen and a bit tall — 896 px of
     * content in an 844 px window, measured at 390 x 844 with the control in
     * the footer row — that scroll arrived a frame after the press and shut the
     * menu before it had drawn a single pixel. The trigger's chevron pointed
     * up, so it read as "the menu is open" while nothing was there. It is also
     * simply better on a phone, where a stray thumb-scroll should not throw
     * away a menu somebody has just opened.
     *
     * Capture phase, because a scroll event from a nested scroller does not
     * bubble to window.
     */
    const onReflow = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) {
        close(false);
        return;
      }
      setPlace(measure());
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open, close, measure]);

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu(e.key === "ArrowDown" ? "current" : "current");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openMenu("last");
    }
  };

  // Arrows cycle, Home/End jump, Tab closes and lets focus move on. The rows
  // are `tabIndex={-1}` so the menu is one tab stop, not three.
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const all = items();
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      all[(at + 1) % all.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      all[(at - 1 + all.length) % all.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      all[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      all[all.length - 1].focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={pending}
        onClick={() => (open ? close() : openMenu("current"))}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // The visible label is the endonym alone; this names what the endonym
        // IS, so the control does not announce as a bare "English".
        aria-label={t("current", { language: current.endonym })}
        data-testid="locale-switcher"
        className={`${hideOnPhone ? "hidden sm:inline-flex" : "inline-flex"} h-8 flex-none items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 t-callout font-medium text-[var(--text-secondary)] transition-[color,background-color,border-color,transform] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:translate-y-px disabled:opacity-60 pointer-coarse:h-11 pointer-coarse:px-3.5`}
      >
        <IconGlobe className="flex-none" />
        {current.endonym}
        <IconChevron up={place?.up ?? false} />
      </button>

      <AnimatePresence>
        {open && place && (
          <PortalPanel key="locale-menu">
            {(present) => (
              <motion.div
                ref={menuRef}
                id={menuId}
                role="menu"
                aria-label={t("choose")}
                aria-orientation="vertical"
                onKeyDown={onMenuKeyDown}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_OUT } }}
                transition={SPRING_POPOVER}
                style={{
                  position: "fixed",
                  right: place.right,
                  top: place.top,
                  bottom: place.bottom,
                  transformOrigin: place.up ? "bottom right" : "top right",
                  // A panel on its way out is not a target.
                  pointerEvents: present ? undefined : "none",
                }}
                className={menuPanelClass}
              >
                {LANGUAGES.map((lang) => {
                  const isCurrent = lang.code === current.code;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isCurrent}
                      tabIndex={-1}
                      disabled={pending}
                      onClick={() => {
                        close();
                        choose(lang.code);
                      }}
                      data-testid={`locale-option-${lang.code}`}
                      className={menuItemClass}
                    >
                      <MenuCheck checked={isCurrent} />
                      {lang.endonym}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </PortalPanel>
        )}
      </AnimatePresence>
    </>
  );
}
