"use client";

/**
 * TopBarChromeSlot — how the top bar's chrome reaches EVERY PageHeader.
 *
 * WHY A CONTEXT AND NOT A PROP
 * ---------------------------
 * `PageHeader` takes `chrome` as an optional prop, and exactly one page ever
 * passed it (the Overview). Every other page rendered a header with no search,
 * no theme switch and no user chip -- and since the identity chip had already
 * been removed from the sidebar footer on the strength of "PageHeader mounts
 * TopBarChrome at every width", the /profile entry point was simply gone on
 * every page but one. A prop that 27 call sites have to remember is not how
 * chrome that must be identical everywhere gets to be identical everywhere.
 *
 * So the LAYOUT renders `<TopBarChrome />` once -- it is an async server
 * component that queries the profile -- and hands the rendered tree to this
 * provider. `PageHeader` reads it back through the slot by default. A page
 * still can pass `chrome={null}` to opt out, and nothing else has to know.
 *
 * Passing a server component INTO a client component as a prop is the
 * supported composition pattern (node_modules/next/dist/docs/01-app/
 * 01-getting-started/05-server-and-client-components.md, "Interleaving"):
 * the server renders it and the client receives output, not code. It also
 * works from client-component pages (PeopleDirectory, TeamLeadBoard, the
 * timesheet grid), which could never have imported `TopBarChrome` directly --
 * it pulls in `next/headers` and the server Supabase client.
 *
 * ONE instance in the DOM, always: the layout renders the chrome once and the
 * header shows it once. Two CSS-hidden copies would be an ambiguous accessible
 * name (the identical bug once fixed on the sidebar toggle).
 */
import { createContext, useContext, type ReactNode } from "react";

const TopBarChromeContext = createContext<ReactNode>(null);

export function TopBarChromeProvider({
  chrome,
  children,
}: {
  chrome: ReactNode;
  children: ReactNode;
}) {
  return <TopBarChromeContext.Provider value={chrome}>{children}</TopBarChromeContext.Provider>;
}

/** Renders whatever the layout supplied; nothing when the env is unconfigured. */
export function TopBarChromeSlot() {
  const chrome = useContext(TopBarChromeContext);
  return <>{chrome}</>;
}
