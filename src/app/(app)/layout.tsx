import { Sidebar } from "@/components/Sidebar";
import { MobileSidebarDrawer } from "@/components/MobileSidebar";
import OnboardingTour from "@/components/OnboardingTour";

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

      {/* Main content — on mobile add top padding for the fixed top bar */}
      <main className="min-w-0 flex-1 overflow-x-hidden pt-12 lg:pt-0">
        {children}
      </main>

      {/* First-time onboarding tour — renders only once, client-side */}
      <OnboardingTour />
    </div>
  );
}
