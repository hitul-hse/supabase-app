/**
 * RoleBadge — the control that makes the four levels of claim distinguishable
 * at a glance.
 *
 * The visual weight is the ladder, deliberately:
 *
 *   RESPONSIBLE   filled chip, strong bezel, 600  — the masterdata names you the lead
 *   OWNER         strong bezel, primary text      — projects.owner_person_id is you
 *   REPLACEMENT   hairline bezel, secondary text  — you are the named cover
 *   ASSIGNED      no bezel, faint text            — you are on the assignment list
 *
 * That asymmetry is the point. Measured for Mathias: 4 responsible, 2 more
 * owned, 36 replacement, 12 plain assigned. A column of 54 identical chips
 * would tell him nothing, and treating "named cover on 36" the same as
 * "accountable for 4" is exactly the misreading this replaces.
 *
 * WHY THE LADDER IS BUILT FROM BEZEL AND WEIGHT, NOT HUE
 * ------------------------------------------------------
 * It used to be: RESPONSIBLE was filled `--accent`, OWNER outlined `--accent`,
 * REPLACEMENT outlined `--warning`. Both are wrong for the same reason, and
 * the band-4 board says so in its own caption — "roles are neutral badges, not
 * tinted, because a role is not a status and teal is reserved for interactive
 * and current (§8 #5, #29)".
 *
 * Teal: `var(--accent)` means INTERACTIVE or CURRENT and nothing else
 * (UI-CONVENTIONS, APPLE_REF §8 #5). The row a shared link selects now carries
 * `--accent-wash` and a 2px `--accent` left rule, so a teal RESPONSIBLE chip
 * inside a teal-washed row put two unrelated meanings of one colour in one
 * row: "this is the row you linked to" and "you are the lead here".
 *
 * Amber: `var(--warning)` means AT RISK. On 36 of Mathias's 54 rows it was
 * saying "replacement", which is a role, not a risk — an amber column that
 * means nothing is amber the reader learns to ignore, including on the rows
 * where it would have meant something.
 *
 * Colour is still never the only signal, because there is now no colour: the
 * words differ, the bezels differ and the weights differ, so this survives a
 * monochrome print, a colour-blind reader, and a row that is itself tinted.
 */
import type { MyRole } from "@/lib/queries/my-work";

const STYLE: Record<MyRole, { className: string; title: string; label: string }> = {
  responsible: {
    label: "RESPONSIBLE",
    className:
      "bg-[var(--surface-hover)] border border-[var(--border-strong)] font-semibold text-[var(--text-primary)]",
    title:
      "The masterdata names you as the responsible lead for this project (project_responsibility.role = 'responsible')",
  },
  owner: {
    label: "OWNER",
    className: "border border-[var(--border-strong)] text-[var(--text-primary)]",
    title: "You are recorded as this project's owner (projects.owner_person_id)",
  },
  replacement: {
    label: "REPLACEMENT",
    className: "border border-[var(--border)] text-[var(--text-secondary)]",
    title:
      "You are the named replacement/cover for this project, not its lead (project_responsibility.role = 'replacement')",
  },
  assigned: {
    label: "ASSIGNED",
    className: "text-[var(--text-faint)]",
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
