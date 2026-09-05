import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Sidebar } from "@/components/Sidebar";
import { MobileSidebarDrawer } from "@/components/MobileSidebar";
import { createClient } from "@/utils/supabase/server";
import { getProfileView } from "@/lib/queries/profile";
import OnboardingTour from "@/components/OnboardingTour";
import { SidebarCollapseProvider } from "@/components/SidebarCollapseContext";
// NOT from SidebarCollapseContext: that module is "use client", so a server
// component importing this constant receives a client-reference proxy instead
// of the string. See sidebar-collapse-shared.ts.
import { SIDEBAR_COOKIE } from "@/components/sidebar-collapse-shared";
import { DesktopSidebarShell } from "@/components/DesktopSidebarShell";
import { StaleDeployNotice } from "@/components/StaleDeployNotice";
import { MotionProvider } from "@/components/animations/MotionProvider";
import { TopBarChrome } from "@/components/TopBarChrome";
import { TopBarChromeProvider } from "@/components/TopBarChromeSlot";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The client-side message catalogue is mounted HERE, inside the
  // authenticated shell, not in the root layout: public pages (/auth/*, /demo)
  // must not ship the dashboard's vocabulary in their HTML.
  const messages = await getMessages();
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

  /*
    Role for the mobile tab bar. This looks like a second profile read on every
    page, and is not: getProfileView is wrapped in oncePerRequest, and <Sidebar/>
    below already calls it during the same render, so the two share one result.
    Resolved on the SERVER so the tab bar renders its correct shape in the first
    byte of HTML rather than flashing the wrong tabs until hydration.
  */
  let roleKey: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const profile = await getProfileView(supabase, user.id, user.email ?? null);
      roleKey = profile?.roleKey ?? null;
    }
  } catch {
    // An unconfigured or unreachable Supabase must not blank the whole shell.
    // The tab bar falls back to the four ungated defaults, which is right:
    // none of them is role-gated in NAV_GROUPS.
    roleKey = null;
  }

  return (
    <NextIntlClientProvider messages={messages}>
    <SidebarCollapseProvider initialCollapsed={collapsed}>
    {/*
      The top bar's chrome (locale, theme, search, the user menu) is rendered
      ONCE, here, and every PageHeader reads it through the slot. TopBarChrome
      is an async server component handed to a client provider as a prop --
      the server renders it and the client receives output, not code -- which
      is what lets client-component pages show it too. See TopBarChromeSlot.
    */}
    <TopBarChromeProvider chrome={<TopBarChrome />}>
    {/* Reduced motion for every framer spring in the shell -- see MotionProvider. */}
    <MotionProvider>
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

      {/* Mobile: drawer wrapping the same Sidebar content, plus the bottom tab
          bar (rendered inside the drawer component, which owns the open state
          the "More" tab both sets and reflects). */}
      <MobileSidebarDrawer roleKey={roleKey}>
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
      {/*
        The tab bar is fixed, so it is out of flow and would otherwise cover the
        last stretch of every page — which on a table is the pager, i.e. the
        control you need exactly when you have scrolled to the bottom.

        The arithmetic changed when the bar started FLOATING, and it has to be
        derived rather than guessed:
             12px  gap below the pill  (its `bottom-[calc(12px+env(safe-area-inset-bottom))]`)
          +  56px  pill height         (`min-h-[56px]` on each tab)
          +  12px  breathing room above it
          +  env(safe-area-inset-bottom)
          =  80px + env(safe-area-inset-bottom)
        The safe-area term is now OUTSIDE the bar (it used to be inner padding),
        so it has to be added here or the last row of content sits behind the
        pill on exactly the notched iPhones the inset exists for.
      */}
      <main className="flex min-w-0 flex-1 flex-col overflow-x-clip pt-12 pb-[calc(80px+env(safe-area-inset-bottom))] lg:pt-0 lg:pb-0">
        {/*
          The global timer strip used to render here, above every page.

          It was removed on 2026-08-25 for two measured reasons. It wrote to
          public.timesheet_entries while every real hour lives in time.entry
          (5,351 rows from TrackingTime and calendar sync), so an hour logged
          with it reached neither utilisation nor any dashboard, yet still fed
          billable_value_by_person and project_budget_status -- a control that
          could distort billing while appearing to do nothing. And it was used
          exactly once in the app's lifetime, against 5,350 synced entries,
          while costing 70px on a phone: 8.3% of the first screen on every
          page, pushing each page's own title down to y=147px.

          The working tracker is /time (TimeTracker + time/actions.ts), which
          has a project picker and writes to time.entry through
          time.current_member_id(). Put a shortcut in the nav if one is wanted;
          do not restore a second tracker that writes to the other table.
        */}
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
    </MotionProvider>
    </TopBarChromeProvider>
    </SidebarCollapseProvider>
    </NextIntlClientProvider>
  );
}
