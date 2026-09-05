"use client";

/**
 * The dark/light theme toggle.
 *
 * HOW THE THEME IS STORED AND APPLIED. One attribute -- data-theme="light" on <html> --
 * plus localStorage. The entire app reads colour through var(--*) tokens, so the attribute
 * selector in globals.css re-derives every surface, border, text and chart colour at once;
 * no component knows which theme is active.
 *
 * WHY AN INLINE SCRIPT IN THE LAYOUT SETS THE ATTRIBUTE FIRST. This component hydrates
 * long after first paint. If it owned the initial application, a light-theme user would
 * watch the page flash dark for however long hydration takes, on every load. So layout.tsx
 * carries a tiny blocking script that reads localStorage and sets the attribute before any
 * CSS is resolved, and this component only handles the CLICK -- it reads the current state
 * from the DOM it trusts the script to have set.
 *
 * WHY NOT prefers-color-scheme AS THE DEFAULT. The app has been dark-only for its whole
 * life, and every colleague's muscle memory is a dark portal. Defaulting suddenly to the
 * OS preference would flip the UI on people who never asked; the OS preference is a fine
 * INITIAL default for someone who has never chosen, which is exactly what the layout
 * script implements: stored choice first, then OS preference, then dark.
 *
 * TWO SHAPES (APPLE_REF §3.1, HIG/toolbars: secondary controls collapse into
 * an overflow on a narrow window). `bar` is the 32 px round button in the top
 * bar, shown from `sm` up; `menuitem` is the same action as a row of the
 * account menu, which `UserMenu` renders only below `sm`. Never both visible
 * at once, so the accessible name exists once at any width.
 */

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { menuItemClass } from "./ui/Menu";

const STORAGE_KEY = "hse-hub-theme";

/*
 * The theme, read through useSyncExternalStore rather than useState+useEffect.
 *
 * The external system IS the DOM attribute the boot script set before hydration, so this
 * is the hook's literal purpose: `getSnapshot` reads it, `getServerSnapshot` returns null
 * (the server genuinely does not know, which renders the neutral placeholder), and the
 * subscription watches the attribute so even another tab of code changing it stays in
 * sync. The previous useState+setState-in-effect version tripped the React compiler's
 * cascading-render rule, and it was right to: this is a subscription, not an effect.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const getSnapshot = (): "dark" | "light" =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";
const getServerSnapshot = (): null => null;

/** Moon and sun, drawn to match nav-icons' 1.5px stroke voice. */
function IconMoon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden className={className}>
      <path
        d="M13.5 9.5a5.5 5.5 0 0 1-7-7 5.5 5.5 0 1 0 7 7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSun({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden className={className}>
      <circle cx="8" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2M12.6 12.6l-1.2-1.2M4.6 4.6 3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ThemeToggle({
  variant = "bar",
  onActivate,
}: {
  variant?: "bar" | "menuitem";
  /** `menuitem` only: called after the switch, so the menu can close and return focus. */
  onActivate?: () => void;
}) {
  const t = useTranslations("common");
  /*
   * null on the server (getServerSnapshot), the real theme after hydration. The neutral
   * placeholder below keeps server and client HTML identical, which is the whole point
   * of the split snapshot.
   */
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    if (next === "light") {
      document.documentElement.dataset.theme = "light";
    } else {
      // Remove rather than set "dark": the dark tokens live on :root, so absence IS dark,
      // and a data-theme="dark" attribute would be a second way to spell the default.
      delete document.documentElement.dataset.theme;
    }
    // The MutationObserver in subscribe() sees the attribute change and re-renders; no
    // local state to keep in step.
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be full or blocked; the theme still applies for this visit.
    }
  };

  // The label names the ACTION, not the state: "Switch to light theme" tells a
  // screen-reader user both what will happen and, implicitly, what is current.
  const label = theme === "light" ? t("themeToDark") : t("themeToLight");

  if (variant === "menuitem") {
    // Inside the menu the row is one tab stop of its parent (tabIndex -1, like
    // every item); the menu itself decides focus. Before hydration the theme is
    // unknown, but a menu can only be open after hydration, so no placeholder.
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={() => {
          toggle();
          onActivate?.();
        }}
        data-testid="menu-theme"
        className={menuItemClass}
      >
        {theme === "light" ? (
          <IconMoon className="flex-none text-[var(--text-secondary)]" />
        ) : (
          <IconSun className="flex-none text-[var(--text-secondary)]" />
        )}
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      // 32 px on desktop (above Apple's 28 icon-only default), 44 on coarse
      // pointers -- the same bump the search IconButtonLink beside it gets.
      // `hidden` below `sm`: the phone's overflow is the menu item above.
      className="hidden h-8 w-8 flex-none items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition-[color,background-color,border-color,transform] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:translate-y-px sm:flex pointer-coarse:h-11 pointer-coarse:w-11"
    >
      {/* Neutral dot until mounted, so SSR and the first client render agree. */}
      {theme === null ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      ) : theme === "light" ? (
        <IconMoon />
      ) : (
        <IconSun />
      )}
    </button>
  );
}
