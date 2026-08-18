"use client";
/** Small sidebar button that clears the tour-done flag so it replays on next page load. */
export function TourReplayButton() {
  return (
    <button
      onClick={() => {
        localStorage.removeItem("hse_tour_done");
        window.location.reload();
      }}
      type="button"
      /*
        Hidden in the rail. It is the least-used control in the footer, and at
        64px there is only room for the ones that matter -- identity and sign
        out. It reappears the moment the sidebar is expanded.
      */
      className="w-full py-0.5 text-left font-mono text-[9.5px] tracking-[0.08em] text-[var(--text-faint)] transition-colors hover:text-[var(--text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] group-data-[collapsed=true]/sidebar:hidden"
    >
      REPLAY TOUR
    </button>
  );
}
