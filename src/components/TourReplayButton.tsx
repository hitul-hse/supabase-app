"use client";
/** Small sidebar button that clears the tour-done flag so it replays on next page load. */
export function TourReplayButton() {
  return (
    <button
      onClick={() => {
        localStorage.removeItem("hse_tour_done");
        window.location.reload();
      }}
      className="w-full text-left font-mono text-[9.5px] tracking-[0.08em] text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors py-0.5"
    >
      ↺ REPLAY TOUR
    </button>
  );
}
