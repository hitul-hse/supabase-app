// Remove the global timer strip from the app shell. CRLF-safe.
//
// Why removal rather than a move: /time already has TimeTracker, a proper
// tracker with a project picker that writes to time.entry through actions.ts.
// The global bar is a second, worse tracker that writes to
// public.timesheet_entries. Moving it to /time would put two trackers on one
// page; keeping it anywhere would keep a control that writes to the wrong table.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/src/app/(app)/layout.tsx";
const src = readFileSync(path, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";

if (!src.includes("TimerBarSlot")) { console.log("already removed"); process.exit(0); }

let out = src;

// 1. Drop the import.
out = out.replace(/^[ \t]*import \{ TimerBarSlot \} from "\.\/TimerBarSlot";[ \t]*\r?\n/m, "");

// 2. Replace the mount with a note that says where the tracker actually lives,
//    so the next person does not "restore" it.
const note = [
  "        {/*",
  "          The global timer strip used to render here, above every page.",
  "",
  "          It was removed on 2026-08-25 for two measured reasons. It wrote to",
  "          public.timesheet_entries while every real hour lives in time.entry",
  "          (5,351 rows from TrackingTime and calendar sync), so an hour logged",
  "          with it reached neither utilisation nor any dashboard, yet still fed",
  "          billable_value_by_person and project_budget_status -- a control that",
  "          could distort billing while appearing to do nothing. And it was used",
  "          exactly once in the app's lifetime, against 5,350 synced entries,",
  "          while costing 70px on a phone: 8.3% of the first screen on every",
  "          page, pushing each page's own title down to y=147px.",
  "",
  "          The working tracker is /time (TimeTracker + time/actions.ts), which",
  "          has a project picker and writes to time.entry through",
  "          time.current_member_id(). Put a shortcut in the nav if one is wanted;",
  "          do not restore a second tracker that writes to the other table.",
  "        */}",
].join(eol);

out = out.replace(/^[ \t]*<TimerBarSlot \/>[ \t]*\r?\n/m, note + eol);

writeFileSync(path, out, "utf8");
console.log(`TimerBarSlot import present after edit: ${/import \{ TimerBarSlot \}/.test(out)}`);
console.log(`<TimerBarSlot /> present after edit:    ${/<TimerBarSlot \/>/.test(out)}`);
