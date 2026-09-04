/**
 * link-icons — the five destination glyphs for the LINKS column on /my-work.
 *
 * WHY SHAPES AND NOT WORDS
 * ------------------------
 * The column used to render `CHAT / TEAMS / ASANA / TT / DRIVE` as bordered
 * text pills. Every pill was the same object except for two to five mono
 * characters, so telling them apart meant READING each one, and a row with
 * four of them wrapped onto three lines inside a 9rem column. "Which of my
 * projects has an Asana board" was a linear read of 54 rows.
 *
 * A silhouette is recognised pre-attentively; a four-letter word is not. So the
 * kind is carried by shape, and the shapes are chosen to be distinct at 16px
 * rather than to be faithful vendor logos (which are trademarked, need colour
 * to work, and would turn the row into a rainbow -- DESIGN.md bans exactly that).
 *
 * HOW THE FIVE ARE KEPT APART
 * ---------------------------
 *   chat        rounded bubble with a tail   -- one round mass, one spur
 *   teams       two heads over a wide base   -- two round masses on top
 *   asana       two ticks beside two rules   -- four separated strokes, striped
 *   trackingtime  circle under a crown bar   -- a circle wearing a hat
 *   drive       a tabbed folder              -- one rectilinear mass, stepped top
 *
 * The bubble and the folder are the closest pair (both are a rounded box), so
 * LINK_ORDER puts them at opposite ends of the strip and they are never
 * adjacent. The bubble's tail points down-left; the folder's tab steps up-left.
 *
 * HOUSE RULES, same as nav-icons.tsx so the two families cannot drift:
 *   - 16x16 viewBox, stroked (never filled), `currentColor`
 *   - stroke-width 1.5, round caps and joins
 *   - drawn on a 1px grid at .5 offsets so edges land on device pixels
 *
 * That last rule is why the column renders them at 16px (h-4 w-4) and not the
 * 14px a table cell invites: at any other size the .5 offsets fall between
 * device pixels and every edge blurs across two, which is the whole reason the
 * grid exists.
 *
 * Every icon is `aria-hidden`. The accessible name lives on the anchor that
 * wraps it (see MyWorkTables' links column) -- an icon is never the name.
 */
import type { MyLink } from "@/lib/queries/my-work";

type IconProps = { className?: string };

function Svg({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Google Chat — a speech bubble, tail down-left. */
export function IconLinkChat({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4.25 2.75h7.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2H7.5l-3.25 2.75V10.25a2 2 0 0 1-2-2v-3.5a2 2 0 0 1 2-2Z" />
    </Svg>
  );
}

/** Microsoft Teams — a team: two figures, the second set back. */
export function IconLinkTeams({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="6" cy="5.25" r="2.25" />
      <path d="M1.75 13.25a4.25 4.25 0 0 1 8.5 0" />
      <path d="M10.5 3.4a2.25 2.25 0 0 1 0 3.7" />
      <path d="M11.4 9.2a4.25 4.25 0 0 1 2.85 4.05" />
    </Svg>
  );
}

/**
 * Asana — a board of tasks, drawn as two ticked lines.
 *
 * Deliberately NOT a kanban frame: at 14px the divider and the cards inside a
 * rounded rectangle land less than a pixel apart and collapse into a grey box.
 * Four well-separated strokes survive the size, and "checked task" is what an
 * Asana board is for.
 */
export function IconLinkBoard({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m2 5.25 1.5 1.5 2.75-3.25" />
      <path d="M8.75 5.25h5.25" />
      <path d="m2 11.25 1.5 1.5 2.75-3.25" />
      <path d="M8.75 11.25h5.25" />
    </Svg>
  );
}

/** TrackingTime — a stopwatch, i.e. hours being counted against the project. */
export function IconLinkTimer({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="9.25" r="4.75" />
      <path d="M8 6.75v2.5l1.75 1" />
      <path d="M6.25 1.75h3.5" />
      <path d="M8 1.75v2.75" />
    </Svg>
  );
}

/** Google Drive — a tabbed folder, the shape people already read as "files". */
export function IconLinkFolder({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M1.75 4.25a1.25 1.25 0 0 1 1.25-1.25h3.15l1.35 1.75h5.25a1.25 1.25 0 0 1 1.25 1.25v6a1.25 1.25 0 0 1-1.25 1.25H3a1.25 1.25 0 0 1-1.25-1.25V4.25Z" />
    </Svg>
  );
}

/**
 * Registry keyed by the link kind, so the column stays declarative and a new
 * kind added to `MyLink` fails the build here rather than rendering an empty
 * box in production.
 */
export const LINK_ICON: Record<MyLink["kind"], (p: IconProps) => React.ReactElement> = {
  google_chat: IconLinkChat,
  microsoft_teams: IconLinkTeams,
  asana: IconLinkBoard,
  trackingtime: IconLinkTimer,
  google_drive: IconLinkFolder,
};
