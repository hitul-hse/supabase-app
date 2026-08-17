import { Sidebar } from "@/components/Sidebar";
import { MobileSidebarDrawer } from "@/components/MobileSidebar";
import OnboardingTour from "@/components/OnboardingTour";
import { TimerBarSlot } from "./TimerBarSlot";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden lg:flex lg:flex-none">
        <Sidebar />
      </div>

      {/* Mobile: drawer wrapping the same Sidebar content */}
      <MobileSidebarDrawer>
        <Sidebar />
      </MobileSidebarDrawer>

      {/*
        Main content — on mobile add top padding for the fixed top bar.

        `overflow-x-clip`, NOT `overflow-x-hidden`. Both stop a wide table forcing
        the page sideways, but `hidden` makes this element a scroll CONTAINER,
        and `position: sticky` inside a scroll container sticks to that container
        rather than to the viewport -- so it silently does nothing on a page that
        scrolls the window. That is what defeated the sticky filter bar on
        /time/dashboard: the class was applied and correct, and the bar still
        scrolled away. `clip` suppresses the overflow without establishing a
        scroll container, which is exactly what was wanted here in the first
        place.
      */}
      <main className="flex min-w-0 flex-1 flex-col overflow-x-clip pt-12 lg:pt-0">
        <TimerBarSlot />
        {children}
      </main>

      {/* First-time onboarding tour — renders only once, client-side */}
      <OnboardingTour />
    </div>
  );
}
