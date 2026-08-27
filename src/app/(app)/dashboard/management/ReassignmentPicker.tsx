"use client";

/**
 * Capacity-aware picker for "who takes this project over".
 *
 * WHAT THIS REPLACED, AND WHY
 * ---------------------------
 * A bare `<select>` of 18 names, alphabetical. From it, "Rency Sebastian" reads
 * exactly like "Azubuike" — yet Rency is responsible for 62 projects AND is the
 * named cover on 62 more, while Azubuike holds nothing. Handing Rency a 63rd
 * project was a single click away and the UI gave no hint at all. Every number
 * below already existed in the database; only the dropdown was hiding it.
 *
 * THE ABSENCE COLUMN IS THE IMPORTANT ONE
 * ---------------------------------------
 * `CandidateLoad.absence` is ALWAYS null right now, because
 * `public.leave_requests` has 0 rows. Null therefore means UNKNOWN, and this
 * renders it as "Abwesenheit unbekannt" in muted text — never as a green light,
 * a blank cell, or an "available" badge. Rendering an empty absence table as
 * availability would be the most expensive lie this screen could tell: the whole
 * point of a handover is that somebody is off, and claiming to know who is free
 * when nothing is known would invert the decision. Factorial time-off fills this
 * later (see the query's header comment); the label switches from "unbekannt" to
 * a real range and nothing else here has to change.
 *
 * WHY NO PERCENT BAR
 * ------------------
 * `time.member.weekly_hours` is a flat 40.00 TrackingTime default for all 49
 * members, so any "78% utilised" figure would be arithmetic on a fabricated
 * denominator. The load is shown in absolute terms and compared BETWEEN people,
 * which is the comparison the data actually supports.
 *
 * WHY A DISCLOSURE, AND WHY IT LOADS ON OPEN
 * -----------------------------------------
 * The customers tab is measured by check:table-scroll-budget (1.65 of a 3-screen
 * desktop budget). An 18-row capacity table inlined per project row would blow
 * that, so it lives behind `<details>`. The fetch is deferred with it: the query
 * is per-project and pages time.entry, so prefetching it for every portfolio row
 * would be hundreds of round trips for a panel opened once.
 */

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { CandidateLoad } from "@/lib/queries/reassignment-candidates";
import type { CustomerPortfolioRow } from "@/lib/queries/management-customer-portfolio";
import {
  loadReassignmentCandidates,
  requestResponsibleChange,
  type ManagementChangeActionState,
} from "./actions";

const IDLE: ManagementChangeActionState = { status: "idle" };

const LABEL = "font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]";
const NUM = "font-mono tabular-nums";

/** Hours to one decimal, and `n/a` for an honest null — never a plausible 0. */
const hours = (value: number | null) =>
  value === null ? "n/a" : new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);

/** The minimum the RPC accepts. Enforced here so nobody meets it as a server error. */
const REASON_MIN = 3;

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="currentColor"
      className={`flex-none transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    >
      <path d="M3 1l5 4-5 4z" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg aria-hidden="true" width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="5" cy="4" r="2" />
      <path d="M5 6v3" />
    </svg>
  );
}

function IconIdea() {
  return (
    <svg aria-hidden="true" width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M5 1.2a2.6 2.6 0 0 0-1.6 4.7V7h3.2V5.9A2.6 2.6 0 0 0 5 1.2Z" />
      <path d="M4 8.6h2" />
    </svg>
  );
}

/**
 * Worst first, per house rule 5: whoever is already carrying the most is at the
 * top where a lead cannot miss them.
 *
 * Nulls sort LAST because a null is unknown load, not zero load — putting it at
 * the "heavy" end would invent a burden and at the light end would invent
 * availability. Inside the null block the ordering falls back to project counts,
 * so somebody with 28 unmeasured projects still outranks somebody holding
 * nothing at all.
 */
function worstFirst(a: CandidateLoad, b: CandidateLoad): number {
  if (a.contractHours === null && b.contractHours !== null) return 1;
  if (b.contractHours === null && a.contractHours !== null) return -1;
  if (a.contractHours !== null && b.contractHours !== null && a.contractHours !== b.contractHours) {
    return b.contractHours - a.contractHours;
  }
  if (a.responsibleFor !== b.responsibleFor) return b.responsibleFor - a.responsibleFor;
  if (a.coversAsReplacement !== b.coversAsReplacement) return b.coversAsReplacement - a.coversAsReplacement;
  return a.personName.localeCompare(b.personName, "de");
}

/**
 * The least-loaded candidate, surfaced as a hint and NEVER auto-selected.
 *
 * Deliberately conservative about what "least loaded" may mean. A person whose
 * contract hours are null because their whole portfolio is unmeasured has an
 * UNKNOWN load and must not be suggested as light — so the only people eligible
 * are those who demonstrably hold nothing (no responsibility, no cover), or
 * failing that the lowest MEASURED hours. Anyone already on the project is
 * excluded: suggesting the person who already has it is not a suggestion.
 *
 * And it stays a hint, because the load numbers are only half the decision. The
 * absence half is unknown (see the file header), so the system is not in a
 * position to choose — the lead knows who is off, and this only makes sure the
 * cheapest option is not buried at the bottom of a worst-first list.
 */
function leastLoaded(candidates: CandidateLoad[]): CandidateLoad | null {
  const eligible = candidates.filter((c) => !c.alreadyOnProject);
  if (!eligible.length) return null;

  const holdsNothing = eligible
    .filter((c) => c.responsibleFor === 0 && c.coversAsReplacement === 0)
    .sort((a, b) => a.loggedLast30Days - b.loggedLast30Days || a.personName.localeCompare(b.personName, "de"));
  if (holdsNothing.length) return holdsNothing[0];

  const measured = eligible
    .filter((c): c is CandidateLoad & { contractHours: number } => c.contractHours !== null)
    .sort((a, b) => a.contractHours - b.contractHours || a.responsibleFor - b.responsibleFor);
  return measured[0] ?? null;
}

/** Relative heat, for colour only. Never printed as a percentage of a fabricated week. */
function loadTone(candidate: CandidateLoad, heaviest: number | null): string {
  if (candidate.contractHours === null || heaviest === null || heaviest <= 0) return "var(--text-muted)";
  const share = candidate.contractHours / heaviest;
  if (share >= 0.66) return "var(--critical)";
  if (share >= 0.33) return "var(--warning, #d99b3d)";
  return "var(--good)";
}

function CandidateRow({
  candidate,
  heaviest,
  selected,
  suggested,
  onSelect,
  groupName,
}: {
  candidate: CandidateLoad;
  heaviest: number | null;
  selected: boolean;
  suggested: boolean;
  onSelect: (id: string) => void;
  groupName: string;
}) {
  /*
   * A radio, not a select option: the whole point is that each choice carries
   * five numbers, and an <option> can only carry a string. The <label> wraps the
   * input so the entire row is the hit target, and the native radio keeps the
   * focus ring and arrow-key grammar for free.
   */
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 border-t border-[var(--divider)] px-2 py-1.5 text-[11px] transition-colors first:border-t-0 hover:bg-[var(--surface-hover)] ${
        selected ? "bg-[var(--accent-wash)]" : ""
      }`}
    >
      <input
        type="radio"
        name={groupName}
        value={candidate.personId}
        checked={selected}
        onChange={() => onSelect(candidate.personId)}
        className="h-3 w-3 flex-none accent-[var(--accent)]"
      />

      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={selected ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>
            {candidate.personName}
          </span>

          {/*
            alreadyOnProject is called out in --warning rather than hidden. The
            person is a legitimate choice (a replacement being promoted is the
            normal handover), but "reassign it to whoever already has it" is a
            real misclick, so it has to be visible before the click.
          */}
          {candidate.alreadyOnProject && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface)] px-1.5 py-px font-mono text-[9px] tracking-[0.08em] text-[var(--warning,#d99b3d)]">
              <IconPin />
              BEREITS AUF PROJEKT
            </span>
          )}

          {suggested && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface)] px-1.5 py-px font-mono text-[9px] tracking-[0.08em] text-[var(--accent)]">
              <IconIdea />
              GERINGSTE LAST
            </span>
          )}
        </span>

        {/*
          The unknown-absence line. Muted, present on EVERY row, and worded as
          ignorance rather than as a status. It is not a green dot and not an
          empty cell, because both would read as "this person is free".
        */}
        <span className="mt-0.5 text-[10px] text-[var(--text-faint)]">
          {candidate.absence === null
            ? "Abwesenheit unbekannt · keine Urlaubsdaten im System"
            : `Abwesend ${candidate.absence.from}–${candidate.absence.to} · ${candidate.absence.kind}`}
        </span>
      </span>

      <span className={`${NUM} w-8 flex-none text-right text-[var(--text-secondary)]`} title="Projekte, für die diese Person verantwortlich ist">
        {candidate.responsibleFor}
      </span>
      <span className={`${NUM} w-8 flex-none text-right text-[var(--text-secondary)]`} title="Projekte, in denen diese Person als Replacement benannt ist">
        {candidate.coversAsReplacement}
      </span>
      <span
        className={`${NUM} w-16 flex-none text-right`}
        style={{ color: loadTone(candidate, heaviest) }}
        title={candidate.contractHours === null ? "Keine belastbaren Vertragsstunden in diesem Portfolio" : "Vertragsstunden der verantworteten Projekte"}
      >
        {hours(candidate.contractHours)}
      </span>
      <span className={`${NUM} w-14 flex-none text-right text-[var(--text-muted)]`} title="Erfasste Stunden der letzten 30 Tage">
        {hours(candidate.loggedLast30Days)}
      </span>
    </label>
  );
}

export function ReassignmentPicker({
  project,
}: {
  project: CustomerPortfolioRow["projects"][number];
}) {
  const [state, action, pending] = useActionState(requestResponsibleChange, IDLE);
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<CandidateLoad[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const requested = useRef(false);
  const groupName = useId();
  const reasonId = useId();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  // Fetch once, on first open. Re-opening the panel reuses what was loaded;
  // a successful request refreshes the route anyway, which remounts this.
  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;
    setLoading(true);
    loadReassignmentCandidates(project.projectId)
      .then((result) => {
        if (result.status === "ok") setCandidates(result.candidates);
        else setLoadError(result.message);
      })
      .catch(() => setLoadError("Kandidaten konnten nicht geladen werden."))
      .finally(() => setLoading(false));
  }, [open, project.projectId]);

  const ordered = candidates ? [...candidates].sort(worstFirst) : [];
  const hint = candidates ? leastLoaded(candidates) : null;
  const measured = ordered.filter((c) => c.contractHours !== null);
  const heaviest = measured.length ? Math.max(...measured.map((c) => c.contractHours as number)) : null;
  const unmeasured = ordered.length - measured.length;

  const reasonOk = reason.trim().length >= REASON_MIN;
  const canSubmit = Boolean(selected) && reasonOk && !pending;

  return (
    <details
      className="group"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[var(--accent)] underline-offset-2 hover:underline">
        {project.responsible.join(", ") || "Nicht zugeordnet"}
        <IconChevron open={open} />
      </summary>

      <form
        action={action}
        className="mt-2 flex w-[min(38rem,80vw)] flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2"
      >
        <input type="hidden" name="project_id" value={project.projectId} />
        {/* The picker below is radios for the UI; this posts the choice. */}
        <input type="hidden" name="person_id" value={selected} />

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className={LABEL}>NEUER VERANTWORTLICHER · AUSLASTUNG DER KANDIDATEN</p>
          <p className="text-[10px] text-[var(--text-faint)]">
            {ordered.length > 0
              ? `${ordered.length} aktive Personen · höchste Last zuerst`
              : ""}
          </p>
        </div>

        {/* Column key, so the four number columns are not four mystery figures. */}
        <div className={`flex items-center gap-2 px-2 ${LABEL}`}>
          <span className="w-3 flex-none" />
          <span className="min-w-0 flex-1">PERSON</span>
          <span className="w-8 flex-none text-right" title="Verantwortlich für">VER</span>
          <span className="w-8 flex-none text-right" title="Als Replacement benannt">COV</span>
          <span className="w-16 flex-none text-right">VERTRAGSH</span>
          <span className="w-14 flex-none text-right">LOG 30T</span>
        </div>

        <div
          className="max-h-[15rem] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)]"
          role="radiogroup"
          aria-label="Kandidaten für die Übernahme, höchste Last zuerst"
        >
          {loading && <p className="px-2 py-3 text-[11px] text-[var(--text-muted)]">Auslastung wird geladen …</p>}
          {loadError && <p className="px-2 py-3 text-[11px] text-[var(--critical)]">{loadError}</p>}
          {!loading && !loadError && ordered.length === 0 && (
            <p className="px-2 py-3 text-[11px] text-[var(--text-muted)]">Keine aktiven Kandidaten verfügbar.</p>
          )}
          {ordered.map((candidate) => (
            <CandidateRow
              key={candidate.personId}
              candidate={candidate}
              heaviest={heaviest}
              selected={selected === candidate.personId}
              suggested={hint?.personId === candidate.personId}
              onSelect={setSelected}
              groupName={groupName}
            />
          ))}
        </div>

        {/*
          What the numbers do and do not mean, next to the numbers. Without this
          a reader is entitled to assume the colours encode availability.
        */}
        {ordered.length > 0 && (
          <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
            Farbe zeigt die Vertragsstunden relativ zum höchsten Wert dieser Liste, keine Auslastungsquote:
            Wochenstunden sind für alle Personen ein TrackingTime-Default von 40,0 h und damit kein belastbarer Nenner.
            {unmeasured > 0 ? ` ${unmeasured} Personen ohne belastbare Vertragsstunden (n/a).` : ""} Abwesenheiten sind
            für niemanden bekannt — Urlaubs- und Krankdaten fehlen im System, die Einschätzung liegt bei der Führungskraft.
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor={reasonId} className={LABEL}>
            ÄNDERUNGSGRUND · PFLICHTFELD · MIND. {REASON_MIN} ZEICHEN
          </label>
          <input
            id={reasonId}
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Grund, z. B. Urlaub / Ausscheiden"
            minLength={REASON_MIN}
            required
            aria-describedby={`${reasonId}-hint`}
            className="rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] focus:border-[var(--accent)]"
          />
          {/*
            Said before submitting, not after. The RPC rejects a reason under 3
            characters, and letting the user discover that as a server error is
            a round trip spent teaching them a rule the form already knows.
          */}
          <p id={`${reasonId}-hint`} className="text-[10px] text-[var(--text-faint)]">
            {reason.trim().length === 0
              ? "Der Grund wird im Änderungsantrag protokolliert und der freigebenden Person angezeigt."
              : reasonOk
                ? "Grund ausreichend."
                : `Noch ${REASON_MIN - reason.trim().length} Zeichen bis zur Mindestlänge.`}
          </p>
        </div>

        <Button type="submit" variant="primary" size="sm" disabled={!canSubmit} busy={pending}>
          Änderungsantrag erstellen
        </Button>

        {/*
          Why the button is off, spelled out. A disabled primary with no
          explanation is the same dead end as the server error it prevents.
        */}
        {!pending && !canSubmit && (
          <p className="text-[10px] text-[var(--text-faint)]">
            {!selected && !reasonOk
              ? "Person auswählen und Grund angeben."
              : !selected
                ? "Person auswählen."
                : "Grund angeben."}
          </p>
        )}

        <p role="status" aria-live="polite" className="min-h-0">
          {state.message && (
            <span className={`text-[10px] ${state.status === "error" ? "text-[var(--critical)]" : "text-[var(--good)]"}`}>
              {state.message}
            </span>
          )}
        </p>
      </form>
    </details>
  );
}
