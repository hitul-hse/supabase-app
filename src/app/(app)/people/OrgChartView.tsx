"use client";

/**
 * The organisation chart: a real reporting tree, and the form for recording it.
 *
 * WHAT CAME BEFORE. Two versions, both wrong in instructive ways. The original
 * drew `org_chart_nodes` -- eight mockup people with invented reporting lines, and
 * worse, those names shipped in the RSC payload of every /people visit even while
 * the real directory was on screen. The replacement grouped the real roster by
 * TrackingTime account role, which was honest but was not an org chart: ADMIN is a
 * permission in a time tracker, not a position.
 *
 * WHY IT CAN BE A TREE NOW. The structure is recorded in the Hub, because
 * TrackingTime cannot supply it (its `supervisor` and `user_group_id` fields are
 * empty for all 49 users). Anyone with people:write can set it here.
 *
 * THE DESIGN RULE, and it is the whole point: an incomplete chart must LOOK
 * incomplete. So unplaced people are listed prominently rather than hidden, the
 * header states how many of the roster are placed, and reporting loops are shown
 * as errors. A chart that renders three tidy boxes while thirty people are missing
 * is how the mockup fooled everyone.
 */

import { useActionState, useState } from "react";
import type { OrgChartData, OrgNode, OrgMember } from "@/lib/queries/org-chart-live";
import { setSupervisor, setMemberDetails } from "./org-actions";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** One person's card, indented by depth. */
function NodeRow({
  node,
  onEdit,
  canEdit,
}: {
  node: OrgNode;
  onEdit: (m: OrgMember) => void;
  canEdit: boolean;
}) {
  return (
    <>
      <div
        className="flex items-center gap-2.5 border-b border-[var(--border)] py-2 pr-3 hover:bg-[var(--surface-hover)]"
        // Indent by depth. A left border per level would be prettier but harder to
        // follow past three levels; a plain offset keeps the name column scannable.
        style={{ paddingLeft: `${12 + node.depth * 22}px` }}
      >
        {node.depth > 0 && (
          <span aria-hidden className="font-mono text-[11px] text-[var(--text-faint)]">
            └
          </span>
        )}
        <span
          aria-hidden
          className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] font-mono text-[9.5px] text-[var(--text-secondary)]"
        >
          {initialsOf(node.name)}
        </span>
        <span className="text-[12.5px] font-medium text-[var(--text-primary)]">{node.name}</span>
        {node.jobTitle && (
          <span className="text-[11.5px] text-[var(--text-secondary)]">{node.jobTitle}</span>
        )}
        {node.team && (
          <span className="border border-[var(--border)] px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.06em] text-[var(--text-muted)]">
            {node.team}
          </span>
        )}
        {node.totalReports > 0 && (
          <span className="font-mono text-[10px] text-[var(--text-faint)]">
            {node.totalReports} REPORT{node.totalReports === 1 ? "" : "S"}
          </span>
        )}
        {!node.hasAccount && (
          <span
            className="font-mono text-[9px] tracking-[0.06em] text-[var(--text-faint)]"
            title="No Hub sign-in yet"
          >
            NO ACCOUNT
          </span>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => onEdit(node)}
            className="ml-auto border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
          >
            EDIT
          </button>
        )}
      </div>
      {node.reports.map((child) => (
        <NodeRow key={child.memberId} node={child} onEdit={onEdit} canEdit={canEdit} />
      ))}
    </>
  );
}

export function OrgChartView({
  chart,
  canEdit,
}: {
  chart: OrgChartData;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<OrgMember | null>(null);
  const [supState, supAction, supPending] = useActionState(setSupervisor, { status: "idle" as const });
  const [detState, detAction, detPending] = useActionState(setMemberDetails, { status: "idle" as const });

  const { roots, unplaced, teams, cycles, totalPeople, placedCount } = chart;

  // Everyone, for the manager picker. Flattened from the tree plus the unplaced,
  // because a manager can legitimately be someone not yet placed themselves.
  const everyone: OrgMember[] = [];
  const collect = (n: OrgNode) => { everyone.push(n); n.reports.forEach(collect); };
  roots.forEach(collect);
  everyone.push(...unplaced);
  everyone.sort((a, b) => a.name.localeCompare(b.name));

  if (totalPeople === 0) {
    return (
      <div className="p-4 sm:p-6">
        <div className="border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">No active people</p>
          <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">
            Nobody in the TrackingTime roster is currently active.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      {/* Completeness, stated up front. A chart is only as good as its coverage,
          and hiding that number is how a mostly-empty chart passes for finished. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            Reporting structure
          </span>
          <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
            RECORDED IN THE HUB · TRACKINGTIME HOLDS NO HIERARCHY
          </span>
        </div>
        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
          {placedCount} OF {totalPeople} PLACED
          {teams.length > 0 && ` · ${teams.length} TEAM${teams.length === 1 ? "" : "S"}`}
        </span>
      </div>

      {(supState.status !== "idle" || detState.status !== "idle") && (
        <p
          role="status"
          className="border border-[var(--border)] px-3 py-2 text-[12.5px] text-[var(--text-primary)]"
          style={{
            background:
              supState.status === "error" || detState.status === "error"
                ? "var(--warning-wash)"
                : "var(--surface-2)",
          }}
        >
          {supState.message ?? detState.message}
        </p>
      )}

      {/* Loops first: a contradiction someone recorded needs fixing before the
          chart below can be trusted. */}
      {cycles.length > 0 && (
        <div
          className="border border-[var(--critical)] p-4"
          style={{ background: "var(--warning-wash)" }}
        >
          <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">
            {cycles.length} reporting loop{cycles.length === 1 ? "" : "s"} recorded
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
            Some people report to each other in a circle, so they cannot be placed
            in a tree. The members involved are listed below as unplaced — clear one
            of their reporting lines to resolve it.
          </p>
        </div>
      )}

      {/* The tree */}
      {roots.length === 0 ? (
        <div className="border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">
            No reporting lines recorded yet
          </p>
          <p className="mx-auto mt-1 max-w-[46ch] text-[12.5px] text-[var(--text-secondary)]">
            TrackingTime does not hold who reports to whom, so nothing can be
            imported. {canEdit
              ? "Use EDIT beside anyone below to record their manager, and the chart will build itself."
              : "Somebody with permission to edit people can record it."}
          </p>
        </div>
      ) : (
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
            REPORTS TO
          </div>
          {roots.map((root) => (
            <NodeRow key={root.memberId} node={root} onEdit={setEditing} canEdit={canEdit} />
          ))}
        </div>
      )}

      {/* Unplaced, never hidden */}
      {unplaced.length > 0 && (
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-2">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              Not yet placed
            </span>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {unplaced.length} OF {totalPeople}
            </span>
          </div>
          <div className="flex flex-col">
            {unplaced.map((m) => (
              <div
                key={m.memberId}
                className="flex items-center gap-2.5 border-b border-[var(--border)] px-4 py-2 hover:bg-[var(--surface-hover)]"
              >
                <span
                  aria-hidden
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] font-mono text-[9.5px] text-[var(--text-secondary)]"
                >
                  {initialsOf(m.name)}
                </span>
                <span className="text-[12.5px] font-medium text-[var(--text-primary)]">{m.name}</span>
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {m.accountRole}
                </span>
                {m.jobTitle && (
                  <span className="text-[11.5px] text-[var(--text-secondary)]">{m.jobTitle}</span>
                )}
                {m.team && (
                  <span className="border border-[var(--border)] px-1.5 py-0.5 font-mono text-[9.5px] text-[var(--text-muted)]">
                    {m.team}
                  </span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditing(m)}
                    className="ml-auto border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                  >
                    EDIT
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The editor. Inline rather than a modal: the list stays visible, which
          matters when the decision being made is about a relationship to it. */}
      {canEdit && editing && (
        <div className="border border-[var(--border-strong)] bg-[var(--surface)] p-4">
          <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] pb-3">
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">
              {editing.name}
            </span>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="font-mono text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              CLOSE
            </button>
          </div>

          <form action={supAction} className="flex flex-wrap items-end gap-2 pt-3">
            <input type="hidden" name="member_id" value={editing.memberId} />
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)]">
                REPORTS TO
              </span>
              <select
                name="supervisor_member_id"
                defaultValue={editing.supervisorMemberId ?? ""}
                disabled={supPending}
                className="min-w-[220px] border border-[var(--border)] bg-[var(--page)] px-2 py-1.5 text-[12.5px] text-[var(--text-primary)] disabled:opacity-50"
              >
                <option value="">Nobody (top of the chart)</option>
                {everyone
                  // Never offer somebody as their own manager. Longer loops are
                  // refused server-side, where the whole chain is visible.
                  .filter((p) => p.memberId !== editing.memberId)
                  .map((p) => (
                    <option key={p.memberId} value={p.memberId}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={supPending}
              className="border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              {supPending ? "Saving…" : "Save manager"}
            </button>
          </form>

          <form action={detAction} className="flex flex-wrap items-end gap-2 pt-3">
            <input type="hidden" name="member_id" value={editing.memberId} />
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)]">
                TEAM
              </span>
              <input
                name="team"
                defaultValue={editing.team ?? ""}
                list="org-teams"
                placeholder="e.g. Safety"
                disabled={detPending}
                className="border border-[var(--border)] bg-[var(--page)] px-2 py-1.5 text-[12.5px] text-[var(--text-primary)] disabled:opacity-50"
              />
              {/* Existing names offered as suggestions, not enforced: teams are a
                  free label until the names settle, and a dropdown of nothing
                  would block the first person who tries to record one. */}
              <datalist id="org-teams">
                {teams.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)]">
                JOB TITLE
              </span>
              <input
                name="job_title"
                defaultValue={editing.jobTitle ?? ""}
                placeholder="e.g. Safety consultant"
                disabled={detPending}
                className="min-w-[200px] border border-[var(--border)] bg-[var(--page)] px-2 py-1.5 text-[12.5px] text-[var(--text-primary)] disabled:opacity-50"
              />
            </label>
            <button
              type="submit"
              disabled={detPending}
              className="border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              {detPending ? "Saving…" : "Save details"}
            </button>
          </form>

          <p className="pt-3 font-mono text-[9.5px] text-[var(--text-faint)]">
            JOB TITLE IS NOT THE SAME AS {editing.accountRole} — THAT IS THIS
            PERSON&apos;S TRACKINGTIME ACCESS LEVEL, NOT THEIR ROLE HERE
          </p>
        </div>
      )}
    </div>
  );
}
