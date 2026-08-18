"use client";

/**
 * SidebarCollapseContext — owns the desktop "is the sidebar hidden?" state for
 * the whole app shell, and persists the choice so it survives a reload and a
 * navigation.
 *
 * Why a cookie and not localStorage: the sidebar is rendered by a SERVER
 * component inside the app layout, so the server has to know the collapsed
 * width before it emits any HTML. localStorage is only readable after
 * hydration, which means the first paint would always be the expanded 220px
 * and then visibly snap shut -- a flash of wrong layout on every single page
 * load for anyone who prefers it collapsed. The cookie arrives with the
 * request, so the server renders the correct width immediately.
 *
 * The provider therefore takes the server-read cookie value as
 * `initialCollapsed` and treats it as the source of truth for the first
 * render. It deliberately does NOT read the cookie itself on mount.
 *
 * Scope: DESKTOP only (lg+). On smaller screens navigation is a slide-in
 * drawer owned by MobileSidebar, and collapsing a drawer that is already
 * hidden is meaningless -- so nothing here is wired into the mobile path.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  SIDEBAR_COOKIE,
  SIDEBAR_COOKIE_MAX_AGE,
} from "./sidebar-collapse-shared";

/*
  The cookie name deliberately lives in a NON-client module. A server component
  importing it from here would receive a client-reference proxy rather than the
  string -- see sidebar-collapse-shared.ts for the full story. Re-exported for
  convenience of client callers only.
*/
export { SIDEBAR_COOKIE };

interface SidebarCollapseValue {
  collapsed: boolean;
  toggle: () => void;
  /**
   * Force the sidebar open and ignore `toggle` until released. Used by the
   * onboarding tour, which spotlights individual nav links by their
   * `data-tour` attribute -- with the sidebar collapsed those elements are
   * unmounted, `getTargetRect` returns null, and 5 of the 8 tour steps would
   * silently show no spotlight at all.
   */
  setForcedOpen: (forced: boolean) => void;
  /** True while something (the tour) is holding the sidebar open. */
  forcedOpen: boolean;
}

const SidebarCollapseContext = createContext<SidebarCollapseValue | null>(null);

export function SidebarCollapseProvider({
  initialCollapsed,
  children,
}: {
  initialCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [forcedOpen, setForcedOpen] = useState(false);

  // Mirror the state onto <html> as a data attribute so plain CSS can react to
  // it (see globals.css). This is what lets the *server-rendered* markup and
  // the client state agree without every consumer needing the context.
  useEffect(() => {
    const el = document.documentElement;
    if (collapsed && !forcedOpen) {
      el.setAttribute("data-sidebar-collapsed", "true");
    } else {
      el.removeAttribute("data-sidebar-collapsed");
    }
  }, [collapsed, forcedOpen]);

  const toggle = useCallback(() => {
    // A forced-open sidebar ignores the toggle rather than queueing it: the
    // user pressing the control mid-tour should not have a hidden effect that
    // fires later when the tour ends.
    if (forcedOpen) return;

    setCollapsed((prev) => {
      const next = !prev;
      // Not httpOnly on purpose -- it has to be writable from the client, and
      // it holds nothing sensitive. SameSite=Lax so it still arrives on the
      // top-level navigations that matter here.
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
      return next;
    });
  }, [forcedOpen]);

  // Keyboard shortcut. Ctrl/Cmd + B is what editors and every major dashboard
  // use for exactly this, so it is the least surprising binding available.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "b" && e.key !== "B") return;
      if (!e.ctrlKey && !e.metaKey) return;
      // Never steal the shortcut from a text field -- Cmd+B is bold there.
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) {
          return;
        }
      }
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const value = useMemo<SidebarCollapseValue>(
    () => ({
      // `forcedOpen` wins over the stored preference without overwriting it, so
      // the user's choice is still there when the tour finishes.
      collapsed: collapsed && !forcedOpen,
      toggle,
      setForcedOpen,
      forcedOpen,
    }),
    [collapsed, forcedOpen, toggle]
  );

  return (
    <SidebarCollapseContext.Provider value={value}>
      {children}
    </SidebarCollapseContext.Provider>
  );
}

/**
 * Read the collapse state. Returns a safe expanded-and-inert default outside a
 * provider so components (and the mobile drawer, which renders the same
 * Sidebar tree without a provider) never crash.
 */
export function useSidebarCollapse(): SidebarCollapseValue {
  const ctx = useContext(SidebarCollapseContext);
  if (!ctx) {
    return {
      collapsed: false,
      toggle: () => {},
      setForcedOpen: () => {},
      forcedOpen: false,
    };
  }
  return ctx;
}
