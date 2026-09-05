/**
 * RoleBadge — the control that makes the four levels of claim distinguishable
 * at a glance.
 *
 * The visual weight is the ladder, deliberately:
 *
 *   RESPONSIBLE   filled accent      — the masterdata names you the lead
 *   OWNER         accent outline     — projects.owner_person_id is you
 *   REPLACEMENT   warning outline    — you are the named cover
 *   ASSIGNED      hairline, muted    — you are on the assignment list
 *
 * That asymmetry is the point. Measured for Mathias: 4 responsible, 2 more
 * owned, 36 replacement, 12 plain assigned. A column of 54 identical chips
 * would tell him nothing, and treating "named cover on 36" the same as
 * "accountable for 4" is exactly the misreading this replaces.
 *
 * Colour is never the only signal — the words differ too, so this survives a
 * monochrome print and a colour-blind reader.
 */
import type { MyRole } from "@/lib/queries/my-work";

const STYLE: Record<MyRole, { className: string; title: string; label: string }> = {
  responsible: {
    label: "RESPONSIBLE",
    className:
      "bg-[var(--accent)] text-[var(--accent-contrast)]",
    title:
      "The masterdata names you as the responsible lead for this project (project_responsibility.role = 'responsible')",
  },
  owner: {
    label: "OWNER",
    className:
      "border border-[var(--accent)] text-[var(--accent)]",
    title: "You are recorded as this project's owner (projects.owner_person_id)",
  },
  replacement: {
    label: "REPLACEMENT",
    className: "border border-[var(--warning)] text-[var(--warning)]",
    title:
      "You are the named replacement/cover for this project, not its lead (project_responsibility.role = 'replacement')",
  },
  assigned: {
    label: "ASSIGNED",
    className: "border border-[var(--border-strong)] text-[var(--text-muted)]",
    title: "You are on this project's assignment list (person_assignments)",
  },
};

export function RoleBadge({ role }: { role: MyRole }) {
  const s = STYLE[role];
  return (
    <span
      title={s.title}
      className={`inline-flex flex-none items-center rounded-full px-2 py-0.5 t-label ${s.className}`}
    >
      {s.label}
    </span>
  );
}
