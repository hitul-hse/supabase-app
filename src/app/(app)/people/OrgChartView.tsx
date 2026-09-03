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
import { useTranslations } from "next-intl";
import type { OrgChartData, OrgNode, OrgMember } from "@/lib/queries/org-chart-live";
import { setSupervisor, setMemberDetails } from "./org-actions";
import { teamLabel, teamOptionsFor } from "@/lib/teams";
import { SearchableSelect } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";

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
  const t = useTranslations("people.orgChart");
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
          className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] font-mono text-[10px] text-[var(--text-secondary)]"
        >
          {initialsOf(node.name)}
        </span>
        <span className="text-[12px] font-medium text-[var(--text-primary)]">{node.name}</span>
        {node.jobTitle && (
          <span className="text-[11px] text-[var(--text-secondary)]">{node.jobTitle}</span>
        )}
        {node.team && (
          <span className="border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] text-[var(--text-muted)]">
            {teamLabel(node.team)}
          </span>
        )}
        {node.totalReports > 0 && (
          <span className="font-mono text-[10px] text-[var(--text-faint)]">
            {t("reports", { count: node.totalReports })}
          </span>
        )}
        {!node.hasAccount && (
          <span
            className="font-mono text-[9px] tracking-[0.06em] text-[var(--text-faint)]"
            title={t("noAccountTitle")}
          >
            {t("noAccount")}
          </span>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => onEdit(node)}
            className="ml-auto border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
          >
            {t("edit")}
          </button>
        )}
      </div>
      {node.reports.map((child) => (
        <NodeRow key={child.memberId} node={child} onEdit={onEdit} canEdit={canEdit} />
      ))}
    </>
  );
}

/**
 * The manager picker — searchable, because "everyone" is the whole active
 * roster and a native select offers nothing beyond first-letter type-ahead
 * for finding a name in it. Rendered with key={editing.memberId} so the
 * selection resets when EDIT moves to a different person.
 *
 * The team picker below it stays a native <select>: four named teams need
 * no search box.
 */
function ManagerPicker({
  editing,
  everyone,
  disabled,
}: {
  editing: OrgMember;
  everyone: OrgMember[];
  disabled: boolean;
}) {
  const t = useTranslations("people.orgChart");
  const [supervisorId, setSupervisorId] = useState(
    editing.supervisorMemberId === null ? "" : String(editing.supervisorMemberId),
  );
  return (
    <SearchableSelect
      className="min-w-[240px]"
      label={t("reportsTo")}
      name="supervisor_member_id"
      options={everyone
        // Never offer somebody as their own manager. Longer loops are
        // refused server-side, where the whole chain is visible.
        .filter((p) => p.memberId !== editing.memberId)
        .map((p) => ({
          value: String(p.memberId),
          name: p.name,
          hint: p.jobTitle ?? undefined,
        }))}
      value={supervisorId}
      onChange={setSupervisorId}
      allowEmpty={{ value: "", name: t("nobody") }}
      disabled={disabled}
    />
  );
}

export function OrgChartView({
  chart,
  canEdit,
}: {
  chart: OrgChartData;
  canEdit: boolean;
}) {
  const t = useTranslations("people.orgChart");
  const [editing, setEditing] = useState<OrgMember | null>(null);
  const [supState, supAction, supPending] = useActionState(setSupervisor, { status: "idle" as const });
  const [detState, detAction, detPending] = useActionState(setMemberDetails, { status: "idle" as const });

  const { roots, unplaced, teams, cycles, totalPeople, placedCount, degraded } = chart;

  // Everyone, for the manager picker. Flattened from the tree plus the unplaced,
  // because a manager can legitimately be someone not yet placed themselves.
  const everyone: OrgMember[] = [];
  const collect = (n: OrgNode) => { everyone.push(n); n.reports.forEach(collect); };
  roots.forEach(collect);
  everyone.push(...unplaced);
  everyone.sort((a, b) => a.name.localeCompare(b.name));

  if (totalPeople === 0) {
    return (
      <div className="page-shell">
        <Card className="p-8 text-center">
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">
            {t("empty.title")}
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
            {t("empty.body")}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 page-shell">
      {/* Completeness, stated up front. A chart is only as good as its coverage,
          and hiding that number is how a mostly-empty chart passes for finished. */}
      <Card className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            {t("heading")}
          </span>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            {t("source")}
          </span>
        </div>
        {/* data-coverage is the English handle for scripts and gates, identical
            in both languages, so a check that wants the placed-of-total figure
            still finds it on the German page. The words are the catalogue's. */}
        <span data-coverage="PLACED" className="font-mono text-[11px] text-[var(--text-secondary)]">
          {t("placed", { placed: placedCount, total: totalPeople })}
          {teams.length > 0 && ` · ${t("teams", { count: teams.length })}`}
        </span>
      </Card>

      {/*
        * Say so when the picture is incomplete.
        *
        * getOrgChart falls back to the RLS-scoped table when the company-wide view
        * is unavailable, which happens if code deploys ahead of its migration --
        * exactly what I did. Without this notice the page looked identical to a
        * legitimately empty chart, so an employee seeing only herself had no way to
        * tell that from "nobody has recorded anything yet".
        */}
      {degraded && (
        <div
          className="border border-[var(--border)] px-4 py-3"
          style={{ background: "var(--warning-wash)" }}
        >
          <p className="text-[12px] font-semibold text-[var(--text-primary)]">
            {t("degraded.title")}
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
            {t("degraded.body")}
          </p>
        </div>
      )}

      {(supState.status !== "idle" || detState.status !== "idle") && (
        <p
          role="status"
          className="border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text-primary)]"
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
          <p className="text-[12px] font-semibold text-[var(--text-primary)]">
            {t("cycles.title", { count: cycles.length })}
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
            {t("cycles.body")}
          </p>
        </div>
      )}

      {/* The tree */}
      {roots.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">
            {t("noLines.title")}
          </p>
          <p className="mx-auto mt-1 max-w-[46ch] text-[12px] text-[var(--text-secondary)]">
            {t("noLines.body")}{" "}
            {canEdit ? t("noLines.canEdit") : t("noLines.readOnly")}
          </p>
        </Card>
      ) : (
        /* The chart CANVAS is a card; its node rows stay compact rows. A node
           is a glyph in a diagram -- elevation per node turns it into a heap. */
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--divider)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
            {t("reportsToHeader")}
          </div>
          {roots.map((root) => (
            <NodeRow key={root.memberId} node={root} onEdit={setEditing} canEdit={canEdit} />
          ))}
        </Card>
      )}

      {/* Unplaced, never hidden */}
      {unplaced.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--divider)] px-4 py-2">
            <span className="text-[12px] font-semibold text-[var(--text-primary)]">
              {t("unplaced.heading")}
            </span>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {t("unplaced.count", { count: unplaced.length, total: totalPeople })}
            </span>
          </div>
          <div className="flex flex-col">
            {unplaced.map((m) => (
              <div
                key={m.memberId}
                className="flex items-center gap-2.5 border-b border-[var(--divider)] px-4 py-2 hover:bg-[var(--surface-hover)]"
              >
                <span
                  aria-hidden
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] font-mono text-[10px] text-[var(--text-secondary)]"
                >
                  {initialsOf(m.name)}
                </span>
                <span className="text-[12px] font-medium text-[var(--text-primary)]">{m.name}</span>
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {m.accountRole}
                </span>
                {m.jobTitle && (
                  <span className="text-[11px] text-[var(--text-secondary)]">{m.jobTitle}</span>
                )}
                {m.team && (
                  <span className="border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                    {teamLabel(m.team)}
                  </span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditing(m)}
                    className="ml-auto border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                  >
                    {t("edit")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
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
              {t("close")}
            </button>
          </div>

          <form action={supAction} className="flex flex-wrap items-end gap-2 pt-3">
            <input type="hidden" name="member_id" value={editing.memberId} />
            <ManagerPicker
              key={editing.memberId}
              editing={editing}
              everyone={everyone}
              disabled={supPending}
            />
            <button
              type="submit"
              disabled={supPending}
              className="border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              {supPending ? t("saving") : t("saveManager")}
            </button>
          </form>

          <form action={detAction} className="flex flex-wrap items-end gap-2 pt-3">
            <input type="hidden" name="member_id" value={editing.memberId} />
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)]">
                {t("team")}
              </span>
              {/* A select, not a text input with suggestions. The business has
                  named its four teams, so "Ops" or "operations" typed by hand
                  would be a team of one that reads as a typo to everyone else.
                  teamOptionsFor keeps any legacy value visible rather than
                  silently replacing it on the next save. */}
              <select
                name="team"
                defaultValue={editing.team ?? ""}
                disabled={detPending}
                className="min-w-[160px] border border-[var(--border)] bg-[var(--page)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] disabled:opacity-50"
              >
                <option value="">{t("teamNone")}</option>
                {teamOptionsFor(editing.team).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)]">
                {t("jobTitle")}
              </span>
              <input
                name="job_title"
                defaultValue={editing.jobTitle ?? ""}
                placeholder={t("jobTitlePlaceholder")}
                disabled={detPending}
                className="min-w-[200px] border border-[var(--border)] bg-[var(--page)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] disabled:opacity-50"
              />
            </label>
            <button
              type="submit"
              disabled={detPending}
              className="border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              {detPending ? t("saving") : t("saveDetails")}
            </button>
          </form>

          <p className="pt-3 font-mono text-[10px] text-[var(--text-faint)]">
            {/* An unrecorded access level renders as nothing, exactly as the
                bare {editing.accountRole} did before. */}
            {t("jobTitleNote", { role: editing.accountRole ?? "" })}
          </p>
        </div>
      )}
    </div>
  );
}
