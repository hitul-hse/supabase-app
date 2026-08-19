"use client";

/**
 * TimerBar — the persistent start/stop strip that sits above every app page.
 *
 * Modelled on the Toggl/TrackingTime timer bar: one always-reachable control
 * so logging an hour never costs a navigation. Manual grid entry stays on the
 * Timesheets page for backfilling; this is for time as it actually happens,
 * which is what produces trustworthy data.
 */

import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { startTimer, stopTimer, discardTimer } from "@/app/(app)/timesheets/timer-actions";
import type { RunningTimer } from "@/lib/queries/types";

/** Seconds → "1:04:09" (or "4:09" under an hour). */
function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

function useElapsedSeconds(startedAt: string | undefined) {
  // Seeded from the server-provided start time, then ticked locally. Deriving
  // from the timestamp (rather than incrementing a counter) keeps it accurate
  // across tab throttling and sleep, where intervals stop firing on schedule.
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? (Date.now() - new Date(startedAt).getTime()) / 1000 : 0,
  );

  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed((Date.now() - new Date(startedAt).getTime()) / 1000);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

export function TimerBar({ running }: { running: RunningTimer | null }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const elapsed = useElapsedSeconds(running?.startedAt);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.message ?? "Something went wrong.");
    });
  };

  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface-2)]">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
        <AnimatePresence mode="wait" initial={false}>
          {running ? (
            <motion.div
              key="running"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.16 }}
              className="flex flex-1 flex-wrap items-center gap-3"
            >
              <span className="relative flex h-2 w-2 flex-none" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping bg-[var(--good)] opacity-60" />
                <span className="relative inline-flex h-2 w-2 bg-[var(--good)]" />
              </span>

              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                  {running.taskName}
                </span>
                <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                  {running.projectName} · {running.isBillable ? "BILLABLE" : "NON-BILLABLE"}
                </span>
              </div>

              <span
                className="ml-auto font-mono text-[19px] font-semibold text-[var(--text-primary)]"
                aria-live="off"
              >
                {formatElapsed(elapsed)}
              </span>

              <button
                onClick={() => run(stopTimer)}
                disabled={isPending}
                className="bg-[var(--critical)] px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
              >
                Stop
              </button>
              <button
                onClick={() => run(discardTimer)}
                disabled={isPending}
                title="Discard without logging time"
                className="text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--critical)] disabled:opacity-50"
              >
                Discard
              </button>
            </motion.div>
          ) : (
            <motion.form
              key="idle"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.16 }}
              action={(formData) => run(() => startTimer(formData))}
              className="flex flex-1 flex-wrap items-center gap-2"
            >
              <input
                name="task_name"
                type="text"
                required
                disabled={isPending}
                placeholder="What are you working on?"
                className="min-w-[180px] flex-1 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
              />
              <input
                name="project_name"
                type="text"
                required
                disabled={isPending}
                placeholder="Project"
                className="w-36 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
              />
              <label className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--text-muted)]">
                <input
                  name="is_billable"
                  type="checkbox"
                  defaultChecked
                  disabled={isPending}
                  className="accent-[var(--accent)]"
                />
                BILLABLE
              </label>
              <button
                type="submit"
                disabled={isPending}
                className="bg-[var(--accent)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {isPending ? "Starting…" : "Start"}
              </button>
            </motion.form>
          )}
        </AnimatePresence>
      </div>

      {error && (
        <p className="px-4 pb-2 text-[11px] text-[var(--critical)] sm:px-6" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
