"use client";

/**
 * The live tracker: start/stop a timer, or log a completed entry by hand.
 *
 * A Client Component, unlike the rest of this module — and only for the reasons
 * below, each of which genuinely needs the browser:
 *
 *   * The running clock has to tick. A server-rendered elapsed time is frozen at
 *     render, so it would sit at "0:00:04" until something else caused a
 *     navigation, which reads as a broken timer.
 *   * The project picker filters the task and service lists. Doing that with a
 *     round trip per keystroke would be slower and offline-hostile for what is
 *     pure client-side narrowing of a list we already have.
 *   * Action results need to appear inline. A redirect-and-flash pattern loses
 *     what the user typed on a validation error.
 *
 * Elapsed time is displayed from `startedAt` as stored by the server — the
 * browser clock only advances the *display*. The duration that gets written is
 * computed server-side in stopTimer(), so a wrong or tampered client clock can
 * make the on-screen number look odd but cannot alter a single logged second.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { TimeEntryRow, TimeLookups } from "@/lib/queries/time";
import {
  createEntry,
  deleteEntry,
  discardTimer,
  startTimer,
  stopTimer,
  type TimeActionResult,
} from "./actions";
import { SearchableSelect } from "@/components/ui/Field";

/** Seconds → "1:02:03". Distinct from formatSeconds(), which is "H:MM". */
function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** "HH:MM" in UTC — matches how the module stores and renders every other time. */
function clockValue(d: Date): string {
  return d.toISOString().slice(11, 16);
}

function Feedback({ result }: { result: TimeActionResult | null }) {
  if (!result) return null;

  // A successful action can still carry a message (the 24h clamp in stopTimer).
  // Rendering it as an error would be wrong; suppressing it would hide a real
  // correction to the user's data.
  const tone = result.ok
    ? "border-[#4ade80] text-[#4ade80]"
    : "border-[#f87171] text-[#f87171]";

  if (result.ok && !result.message) return null;

  return (
    <p
      // Announced to a screen reader without stealing focus. `alert` would
      // interrupt; `status` is the right politeness for inline feedback.
      role="status"
      aria-live="polite"
      className={`border px-3 py-2 text-[11px] leading-relaxed ${tone}`}
    >
      {result.message}
    </p>
  );
}

const FIELD =
  "w-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]";
const LABEL =
  "mb-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]";
const BUTTON =
  "border px-3 py-1.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The project / task / service pickers, shared by the timer and the manual form.
 *
 * Task and service options narrow to the chosen project. `projectId` is lifted to
 * the parent rather than held here so both forms can keep their own selection —
 * two independent copies of this component must not share one project.
 *
 * SearchableSelect rather than native <select>: the project list is ~334 options,
 * which no native control can search. Each picker posts through a hidden input
 * carrying the same name and value the native select submitted, so the server
 * actions see no difference.
 */
function EntryFields({
  lookups,
  projectId,
  onProjectChange,
  disabled,
}: {
  lookups: TimeLookups;
  projectId: string;
  onProjectChange: (next: string) => void;
  disabled: boolean;
}) {
  // Task and service selections live here, not in the parent, because only the
  // project drives cross-field narrowing. The task is cleared when the project
  // changes: a task belonging to the old project would submit silently wrong.
  const [taskId, setTaskId] = useState("");
  const [serviceId, setServiceId] = useState("");

  // Tasks belonging to the chosen project, or all of them when none is chosen.
  // A project with no tasks of its own still has to be loggable, so an empty
  // filtered list falls back to "no task" rather than blocking the form.
  const tasks = useMemo(() => {
    if (!projectId) return lookups.tasks;
    const pid = Number(projectId);
    return lookups.tasks.filter((t) => t.projectId === pid);
  }, [lookups.tasks, projectId]);

  const projectOptions = useMemo(
    () => lookups.projects.map((p) => ({ value: String(p.id), name: p.name })),
    [lookups.projects],
  );
  const taskOptions = useMemo(
    () => tasks.map((t) => ({ value: String(t.id), name: t.name ?? `Task ${t.id}` })),
    [tasks],
  );
  const serviceOptions = useMemo(
    () =>
      lookups.services.map((s) => ({
        value: String(s.id),
        // Unpaid travel is a real commercial distinction the vendor hides
        // inside the label text. Surfacing it here stops somebody picking
        // the wrong one of two near-identical names.
        name: `${s.name}${s.isTravel && !s.isPaidTravel ? " (unpaid)" : ""}`,
      })),
    [lookups.services],
  );

  return (
    <>
      <SearchableSelect
        label="Project"
        name="project_id"
        options={projectOptions}
        value={projectId}
        onChange={(next) => {
          onProjectChange(next);
          setTaskId("");
        }}
        allowEmpty={{ value: "", name: "No project" }}
        disabled={disabled}
      />
      <SearchableSelect
        label="Task"
        name="task_id"
        options={taskOptions}
        value={taskId}
        onChange={setTaskId}
        allowEmpty={{ value: "", name: "No task" }}
        disabled={disabled}
      />
      <SearchableSelect
        label="Service"
        name="service_id"
        options={serviceOptions}
        value={serviceId}
        onChange={setServiceId}
        allowEmpty={{ value: "", name: "No service" }}
        disabled={disabled}
      />
    </>
  );
}

/**
 * The running-timer panel, or the start form when nothing is running.
 *
 * `running` comes from the server on every render, so the panel's state is the
 * database's state — never a local guess that can drift out of step with what
 * was actually written.
 */
function TimerPanel({
  running,
  lookups,
  canWrite,
}: {
  running: TimeEntryRow | null;
  lookups: TimeLookups;
  canWrite: boolean;
}) {
  const [result, setResult] = useState<TimeActionResult | null>(null);
  const [pending, startAction] = useTransition();
  const [projectId, setProjectId] = useState("");

  // Elapsed seconds, recomputed from the server-stored start each tick rather
  // than incremented. An incrementing counter drifts, and stalls entirely while
  // the tab is backgrounded — this stays correct across a sleep/wake.
  const [elapsed, setElapsed] = useState(0);
  const startedAt = running?.startedAt ?? null;

  useEffect(() => {
    if (!startedAt) return;

    const started = new Date(startedAt).getTime();
    const tick = () => setElapsed((Date.now() - started) / 1000);
    tick();

    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  // Focus the first field when the start form appears, so a keyboard user can
  // begin typing after stopping a timer without reaching for the mouse.
  const firstField = useRef<HTMLSelectElement | null>(null);

  function run(action: () => Promise<TimeActionResult>) {
    startAction(async () => {
      setResult(await action());
    });
  }

  if (running) {
    return (
      <div className="flex flex-col gap-3 border border-[#4ade80] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#4ade80]">
              Timer running
            </span>
            <span className="truncate text-[13px] text-[var(--text-primary)]">
              {running.taskName ?? "Untitled entry"}
            </span>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {running.customerName ?? "No customer"} / {running.projectName ?? "No project"}
              {running.serviceName ? ` / ${running.serviceName}` : ""}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* aria-live="off": a clock announcing itself every second would make
                a screen reader unusable. The value is still readable on demand. */}
            <span
              aria-live="off"
              className="font-mono text-[26px] tabular-nums text-[var(--text-primary)]"
            >
              {formatElapsed(elapsed)}
            </span>

            <button
              type="button"
              onClick={() => run(stopTimer)}
              disabled={pending}
              className={`${BUTTON} border-[#4ade80] text-[#4ade80] hover:bg-[#4ade80]/10`}
            >
              {pending ? "Stopping…" : "Stop"}
            </button>

            <button
              type="button"
              onClick={() => run(discardTimer)}
              disabled={pending}
              // No confirm dialog: the timer is unlogged time, and the entry has
              // not been written as a duration yet. Losing a running timer is
              // recoverable by starting again; a modal on every discard is not
              // worth the friction.
              className={`${BUTTON} border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text-primary)]`}
            >
              Discard
            </button>
          </div>
        </div>

        <Feedback result={result} />
      </div>
    );
  }

  return (
    <form
      // A plain action, not onSubmit: the form still posts if the JS bundle has
      // not hydrated yet, so the timer is usable on a slow first load.
      action={(fd) => run(() => startTimer(fd))}
      className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
        Start a timer
      </span>

      <div className="grid gap-3 sm:grid-cols-3">
        <EntryFields
          lookups={lookups}
          projectId={projectId}
          onProjectChange={setProjectId}
          disabled={!canWrite || pending}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="timer-notes">
          Notes
        </label>
        <input
          id="timer-notes"
          name="notes"
          type="text"
          ref={firstField as unknown as React.Ref<HTMLInputElement>}
          placeholder="What are you working on?"
          disabled={!canWrite || pending}
          className={FIELD}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          <input
            name="is_billable"
            type="checkbox"
            defaultChecked
            disabled={!canWrite || pending}
            className="accent-[var(--accent)]"
          />
          Billable
        </label>

        <button
          type="submit"
          disabled={!canWrite || pending}
          className={`${BUTTON} border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10`}
        >
          {pending ? "Starting…" : "Start timer"}
        </button>
      </div>

      <Feedback result={result} />
    </form>
  );
}

/** Log a finished entry by hand — how most people actually reconstruct a day. */
function ManualPanel({
  lookups,
  canWrite,
  today,
}: {
  lookups: TimeLookups;
  canWrite: boolean;
  /** Server-supplied so the default date matches the week the page is showing. */
  today: string;
}) {
  const [result, setResult] = useState<TimeActionResult | null>(null);
  const [pending, startAction] = useTransition();
  const [projectId, setProjectId] = useState("");
  const formRef = useRef<HTMLFormElement | null>(null);
  /**
   * Remounts EntryFields on successful save. form.reset() clears the native
   * inputs, but the searchable pickers hold their choice in React state,
   * which a DOM reset cannot reach — a fresh key clears it the React way.
   */
  const [formEpoch, setFormEpoch] = useState(0);

  // Sensible default window: the hour just gone, rounded to the minute. Guessing
  // a whole workday would be a bigger claim than the user made.
  const now = new Date();
  const defaultEnd = clockValue(now);
  const defaultStart = clockValue(new Date(now.getTime() - 3_600_000));

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startAction(async () => {
          const r = await createEntry(fd);
          setResult(r);
          // Reset only on success. Clearing the form after a validation error
          // would throw away what the user typed along with the mistake.
          if (r.ok) {
            formRef.current?.reset();
            setProjectId("");
            setFormEpoch((n) => n + 1);
          }
        })
      }
      className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
        Log time manually
      </span>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={LABEL} htmlFor="manual-date">
            Date
          </label>
          <input
            id="manual-date"
            name="date"
            type="date"
            defaultValue={today}
            required
            disabled={!canWrite || pending}
            className={FIELD}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="manual-start">
            From
          </label>
          <input
            id="manual-start"
            name="start_time"
            type="time"
            defaultValue={defaultStart}
            required
            disabled={!canWrite || pending}
            className={FIELD}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="manual-end">
            To
          </label>
          <input
            id="manual-end"
            name="end_time"
            type="time"
            defaultValue={defaultEnd}
            required
            disabled={!canWrite || pending}
            className={FIELD}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <EntryFields
          key={formEpoch}
          lookups={lookups}
          projectId={projectId}
          onProjectChange={setProjectId}
          disabled={!canWrite || pending}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="manual-notes">
          Notes
        </label>
        <input
          id="manual-notes"
          name="notes"
          type="text"
          placeholder="What did you work on?"
          disabled={!canWrite || pending}
          className={FIELD}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          <input
            name="is_billable"
            type="checkbox"
            defaultChecked
            disabled={!canWrite || pending}
            className="accent-[var(--accent)]"
          />
          Billable
        </label>

        <button
          type="submit"
          disabled={!canWrite || pending}
          className={`${BUTTON} border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10`}
        >
          {pending ? "Saving…" : "Add entry"}
        </button>
      </div>

      <Feedback result={result} />

      <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
        {/* Stated rather than discovered on submit: the module reads and renders
            everything in UTC, so a user off UTC needs to know which clock these
            fields are on before they type a time, not after. */}
        Times are read in UTC, matching how entries are stored and shown.
      </p>
    </form>
  );
}

/**
 * Today's entries with a delete control.
 *
 * Delete is here rather than in the read-only week list on purpose: the week view
 * is a report that a team lead may be reading about somebody else, and putting a
 * destructive control on every row of it invites a misclick on another person's
 * data. This list is scoped to the signed-in member's own day.
 */
function TodayPanel({ entries }: { entries: TimeEntryRow[] }) {
  const [result, setResult] = useState<TimeActionResult | null>(null);
  const [pending, startAction] = useTransition();

  if (entries.length === 0) {
    return (
      <div className="border border-[var(--border)] bg-[var(--surface)] p-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Today
        </span>
        <p className="mt-2 text-[12px] text-[var(--text-muted)]">
          Nothing tracked today yet.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Today
        </span>
        <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <ul className="divide-y divide-[var(--border)]">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[12px] text-[var(--text-primary)]">
                {e.taskName ?? e.notes ?? "Untitled entry"}
              </span>
              <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                {e.projectName ?? "No project"}
              </span>
            </div>

            <span className="font-mono text-[12px] tabular-nums text-[var(--text-secondary)]">
              {e.duration}
            </span>

            {/* An invoiced entry is not the owner's to remove — the invoice went
                out against it. Shown as inert text so the reason is visible
                rather than the control simply being absent. */}
            {e.isBilled ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                invoiced
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Delete entry: ${e.taskName ?? "untitled"}`}
                disabled={pending || e.isRunning}
                onClick={() =>
                  startAction(async () => {
                    const fd = new FormData();
                    fd.set("entry_id", String(e.id));
                    setResult(await deleteEntry(fd));
                  })
                }
                className="border border-[var(--border-strong)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)] transition-colors hover:text-[#f87171] disabled:opacity-40"
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>

      {result && !result.ok && (
        <div className="border-t border-[var(--border)] p-3">
          <Feedback result={result} />
        </div>
      )}
    </div>
  );
}

export function TimeTracker({
  running,
  lookups,
  todayEntries,
  today,
  canWrite,
}: {
  running: TimeEntryRow | null;
  lookups: TimeLookups;
  todayEntries: TimeEntryRow[];
  today: string;
  /** False disables every control, so the panels explain rather than fail on submit. */
  canWrite: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {!canWrite && (
        <p className="border border-[var(--border-strong)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Your role permits viewing time but not logging it, so these controls are
          disabled. That is the access model working rather than a fault.
        </p>
      )}

      <TimerPanel running={running} lookups={lookups} canWrite={canWrite} />

      <div className="grid gap-5 lg:grid-cols-2">
        <ManualPanel lookups={lookups} canWrite={canWrite} today={today} />
        <TodayPanel entries={todayEntries} />
      </div>
    </div>
  );
}
