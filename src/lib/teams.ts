/**
 * The teams a person can belong to.
 *
 * WHY A FIXED LIST, AND WHY HERE. This was free text in the users table, so the
 * live data had drifted to the mockup's invented labels -- `ENG` and `SAFETY`,
 * inherited from the eight seeded people and typed by hand. Free text on a field
 * that gets compared with `=` means a typo silently creates a new team of one, and
 * nobody notices until someone's scoping looks wrong.
 *
 * The list is defined once and imported by every surface that reads or writes a
 * team: the invite form, the users table, and the org chart's editor. The previous
 * arrangement had the invite form offering SAFETY/ENG/LAB from a hardcoded <select>
 * while the table beside it accepted any string at all, so the two disagreed about
 * what a valid team was.
 *
 * TEAM, NOT DEPARTMENT. The column is still `department` in the database and still
 * feeds app_user_department(); renaming a column that appears in RLS policies is a
 * migration with real risk and no user-visible benefit. So the label changes and
 * the storage does not. That distinction is worth keeping in mind when reading the
 * policies: `department` there means exactly what "team" means here.
 */

/** One selectable team. `value` is what is stored; `label` is what a person reads. */
export type TeamOption = { value: string; label: string };

/**
 * The four real teams, as given by the business.
 *
 * Values are stored uppercase to match what is already in the database (`ENG`,
 * `SAFETY` were stored that way), so a future migration mapping old values to new
 * has one convention to deal with rather than two.
 */
export const TEAMS: readonly TeamOption[] = [
  { value: "ORGA", label: "Orga" },
  { value: "OPERATIONS", label: "Operations" },
  { value: "TECH", label: "Tech" },
  { value: "HR", label: "HR" },
] as const;

/**
 * Labels for values that are stored but no longer offered.
 *
 * Four accounts currently hold `ENG` or `SAFETY`, left over from the mockup. A
 * dropdown listing only the four real teams would render those as blank -- the
 * value would still be stored, invisibly, and the first save would silently
 * overwrite it. Naming them keeps the current state legible until somebody
 * deliberately reassigns those people.
 */
const LEGACY_LABELS: Record<string, string> = {
  ENG: "Engineering (legacy)",
  SAFETY: "Safety (legacy)",
  LAB: "Lab & measurement (legacy)",
};

/** What to show for a stored value, including ones no longer on the list. */
export function teamLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const known = TEAMS.find((t) => t.value === value);
  if (known) return known.label;
  return LEGACY_LABELS[value] ?? value;
}

/** True when a stored value is one of the current four. */
export function isCurrentTeam(value: string | null | undefined): boolean {
  return Boolean(value) && TEAMS.some((t) => t.value === value);
}

/**
 * The options to render for a given current value.
 *
 * If the value is a legacy one, it is appended so the select can show it as
 * selected rather than falling back to the first option -- which would misreport
 * that person's team the moment the row rendered.
 */
export function teamOptionsFor(current: string | null | undefined): TeamOption[] {
  const options = [...TEAMS];
  if (current && !isCurrentTeam(current)) {
    options.push({ value: current, label: teamLabel(current) });
  }
  return options;
}
