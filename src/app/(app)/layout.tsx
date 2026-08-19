import { cookies } from "next/headers";
import { Sidebar } from "@/components/Sidebar";
import { MobileSidebarDrawer } from "@/components/MobileSidebar";
import OnboardingTour from "@/components/OnboardingTour";
import { SidebarCollapseProvider } from "@/components/SidebarCollapseContext";
// NOT from SidebarCollapseContext: that module is "use client", so a server
// component importing this constant receives a client-reference proxy instead
// of the string. See sidebar-collapse-shared.ts.
import { SIDEBAR_COOKIE } from "@/components/sidebar-collapse-shared";
import { DesktopSidebarShell } from "@/components/DesktopSidebarShell";
import { StaleDeployNotice } from "@/components/StaleDeployNotice";
import { TimerBarSlot } from "./TimerBarSlot";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  /*
    Read the collapse preference on the SERVER so the first paint already has
    the right width. Doing this client-side would render 220px, hydrate, then
    snap shut -- a visible layout jump on every page load for anyone who keeps
    the sidebar hidden.

    `cookies()` is async in Next 16 and opts this layout into dynamic
    rendering. That costs nothing here: <Sidebar/> already calls
    supabase.auth.getUser() on every request, so this subtree was never
    static to begin with.
  */
  const cookieStore = await cookies();
  const collapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <SidebarCollapseProvider initialCollapsed={collapsed}>
    <div className="flex min-h-screen">
      {/* Desktop sidebar — collapsible; hidden entirely on mobile */}
      <DesktopSidebarShell>
        {/*
          Only THIS instance gets the collapse control. The drawer copy below
          renders the same component, and two buttons sharing one aria-label
          would give screen reader users an ambiguous target.
        */}
        <Sidebar showCollapseControl />
      </DesktopSidebarShell>

      {/*
        No floating edge button any more. It existed because the sidebar used
        to collapse to width 0, taking its own toggle with it; the rail keeps
        the panel -- and therefore the control -- permanently on screen.
      */}

      {/* Mobile: drawer wrapping the same Sidebar content */}
      <MobileSidebarDrawer>
        <Sidebar />
      </MobileSidebarDrawer>

      {/*
        Main content — on mobile add top padding for the fixed top bar.

        `overflow-x-clip`, NOT `overflow-x-hidden`. Both stop a wide table forcing
        the page sideways, but `hidden` makes this element a scroll CONTAINER, which
        changes the behaviour of everything inside it: `position: sticky` then
        sticks to this element rather than to the viewport, and programmatic
        scrolling targets it instead of the window. `clip` suppresses the overflow
        without establishing a scroll container, which is what was actually wanted.

        Do not "simplify" this to `hidden`. It was `hidden` once, and the sticky
        table headers on /time/dashboard silently did nothing -- the classes were
        present and correct, and the headers still scrolled away.
      */}
      <main className="flex min-w-0 flex-1 flex-col overflow-x-clip pt-12 lg:pt-0">
        <TimerBarSlot />
        {children}
      </main>

      {/* First-time onboarding tour — renders only once, client-side */}
      <OnboardingTour />

      {/*
        Skew recovery, mounted shell-wide because every page in here saves through
        Server Actions. When a deploy lands while a tab is open, that tab's action
        IDs no longer exist server-side (measured: HTTP 404 with
        x-nextjs-action-not-found=1), and the user's save fails. This says so and
        offers a reload instead of the page breaking with no explanation.
      */}
      <StaleDeployNotice />
    </div>
    </SidebarCollapseProvider>
  );
}
