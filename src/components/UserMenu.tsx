"use client";

/**
 * UserMenu — the top bar's account control, and the one /profile entry point
 * on every page (APPLE_REF §5.1 "trailing: … user menu"; §8 #30).
 *
 * WHAT IT IS
 * ----------
 * A chip (avatar + name + role, avatar alone below `sm`) that opens a menu:
 * Profile, Replay tour, then Log out. Sign-out and the tour used to be two rows
 * at the FOOT of the sidebar -- the least-looked-at pixels on screen, and the
 * place Apple says never to put actions ("Avoid putting critical information
 * or actions at the bottom of a sidebar"). They live here now, under the
 * identity they act on, which is also where iCloud.com and every dashboard
 * this app was measured against put them. The sidebar foot keeps only the
 * passive connection dot.
 *
 * THE MENU IS A PORTAL. `<main>` is `overflow-x-clip` and the header sits in
 * flow inside it; a panel positioned inside the chip would be cut at the main
 * edge on a narrow window. It renders on `document.body` at a fixed position
 * measured from the trigger (§5.8: "anchored at the trigger with
 * `transform-origin` there") and closes on scroll, because a fixed panel
 * under an in-flow trigger would otherwise detach from it.
 *
 * KEYBOARD (WAI-ARIA menu button): Enter/Space/ArrowDown open on the first
 * item, ArrowUp opens on the last; arrows cycle, Home/End jump, Escape closes
 * and returns focus to the chip, Tab closes and lets focus move on. Items are
 * `tabIndex={-1}` so the menu is one tab stop, not four.
 *
 * MOTION: none here, deliberately -- a plain mount. §6.2 gives the values
 * (spring 0.28 s, bounce 0, scale .96 → 1 + opacity, origin at the trigger;
 * 120 ms fade out; reduced motion = 150 ms fade). The panel already carries
 * `transform-origin: top right` and framer-motion 13 is installed; the motion
 * engineer wraps the portal content in `AnimatePresence` + `motion.div`.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Avatar } from "./Avatar";
import { LogoutButton } from "./LogoutButton";
import { TourReplayButton } from "./TourReplayButton";
import { IconUser } from "./nav-icons";
import { MenuSeparator, menuItemClass, menuPanelClass } from "./ui/Menu";

/** 8 px between the chip and the panel (§5.8: no arrow needed at this offset). */
const GAP = 8;

export function UserMenu({
  name,
  email,
  role,
  avatarUrl,
}: {
  name: string;
  email: string | null;
  role: string | null;
  avatarUrl: string | null;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [initialFocus, setInitialFocus] = useState<"first" | "last">("first");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const triggerId = useId();

  const openMenu = useCallback((focus: "first" | "last") => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    // Right-aligned to the chip, which sits at the trailing edge of the bar;
    // clamped so the panel never leaves the viewport on a narrow window.
    setPos({ top: r.bottom + GAP, right: Math.max(GAP, window.innerWidth - r.right) });
    setInitialFocus(focus);
    setOpen(true);
  }, []);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Focus the first or last item once the panel is in the DOM.
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!items?.length) return;
    (initialFocus === "last" ? items[items.length - 1] : items[0]).focus();
  }, [open, initialFocus]);

  // Outside pointer-down, scroll and resize all close it without moving focus.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openMenu("first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openMenu("last");
    }
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    const current = document.activeElement as HTMLElement | null;
    const i = current ? items.indexOf(current) : -1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        items[(i + 1) % items.length]?.focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        items[(i - 1 + items.length) % items.length]?.focus();
        break;
      case "Home":
        e.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case " ":
        // Space activates a link item too (a menu convention; on a bare
        // anchor it would scroll the page instead).
        if (current?.tagName === "A") {
          e.preventDefault();
          current.click();
        }
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <>
      {/*
        32 px tall (the `md` control height) with the 24 px avatar inside; a
        44 px target on coarse pointers, like the icon buttons beside it. The
        name is text on desktop rather than a monogram alone: across a
        49-person company two colleagues share initials often enough that an
        avatar is not an identity. Below `sm` the name goes and the aria-label
        carries it, because a name plus a role in a 390 px bar pushes the page
        title off screen.
      */}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("accountMenu", { name })}
        data-testid="topbar-user"
        onClick={() => (open ? close() : openMenu("first"))}
        onKeyDown={onTriggerKeyDown}
        className="flex h-8 flex-none items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-1 pr-1 transition-[color,background-color,border-color,transform] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] active:translate-y-px aria-expanded:border-[var(--border-strong)] aria-expanded:bg-[var(--surface-hover)] sm:pr-3 pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
      >
        <Avatar name={name} src={avatarUrl} size={24} />
        <span className="hidden min-w-0 flex-col sm:flex">
          <span className="truncate t-callout font-medium text-[var(--text-primary)]">{name}</span>
          {role && (
            <span className="truncate t-label text-[var(--text-faint)]">{role.toUpperCase()}</span>
          )}
        </span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-labelledby={triggerId}
            data-testid="user-menu"
            onKeyDown={onMenuKeyDown}
            style={{ position: "fixed", top: pos.top, right: pos.right, transformOrigin: "top right" }}
            className={menuPanelClass}
          >
            {/* Who this menu acts for. The chip shows name + role; the e-mail
                is the one identity fact that is unambiguous, so it lives here. */}
            <div className="px-3 pb-1.5 pt-2">
              <p className="truncate t-callout font-medium text-[var(--text-primary)]">{name}</p>
              {email && <p className="truncate t-subhead text-[var(--text-muted)]">{email}</p>}
            </div>
            <MenuSeparator />
            <Link
              role="menuitem"
              tabIndex={-1}
              href="/profile"
              data-testid="menu-profile"
              className={menuItemClass}
              onClick={() => setOpen(false)}
            >
              <IconUser className="flex-none text-[var(--text-secondary)]" />
              {t("profile")}
            </Link>
            <TourReplayButton />
            <MenuSeparator />
            <LogoutButton variant="menuitem" />
          </div>,
          document.body,
        )}
    </>
  );
}
