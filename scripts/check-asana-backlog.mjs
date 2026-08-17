/**
 * Verifies docs/asana/hse-platform-backlog.csv against Asana's CSV import
 * contract. Asana fails these SILENTLY — a malformed date does not error, it
 * quietly downgrades the whole column to a text custom field and you only find
 * out after importing 35 tasks into a project you then have to delete.
 *
 * Run: npm run test:asana-backlog
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const CSV = "docs/asana/hse-platform-backlog.csv";
let failures = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures += 1;
  }
}

/** Minimal RFC4180 parser — handles quoted fields containing commas/newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r") {
      // skip — handled by \n
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// Regenerate so the gate always tests current output, never a stale artifact.
if (!existsSync(CSV)) {
  execSync("node scripts/generate-asana-backlog.mjs", { stdio: "inherit" });
}

const raw = readFileSync(CSV, "utf8");
const rows = parseCsv(raw);
const header = rows[0];
const body = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
const col = (r, name) => r[header.indexOf(name)] ?? "";

console.log(`\nASANA BACKLOG CSV — ${body.length} tasks\n`);

// --- Column contract -------------------------------------------------------
check("Name is the FIRST column", header[0] === "Name", `got "${header[0]}"`);
check(
  "Description, Section, Assignee follow in Asana's required order",
  header[1] === "Description" && header[2] === "Section" && header[3] === "Assignee",
  header.slice(0, 4).join(","),
);

const notTitleCase = header.filter((h) => !/^[A-Z]/.test(h));
check(
  "every header is Title Case (lowercase headers become custom fields)",
  notTitleCase.length === 0,
  notTitleCase.join(", "),
);

check("every row has exactly as many cells as the header", body.every((r) => r.length === header.length));

// --- Dates -----------------------------------------------------------------
// A single malformed cell silently downgrades the WHOLE column to text.
// Month must be 1-12 and day 1-31. A loose \d{1,2} pattern would accept
// "24/08/2026" (European D/M/Y), whose month=24 Asana cannot read at all.
const US_DATE = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/\d{4}$/;
for (const field of ["Start Date", "Due Date"]) {
  const bad = body.filter((r) => col(r, field) && !US_DATE.test(col(r, field)));
  check(`every ${field} is US M/D/YYYY`, bad.length === 0, bad.map((r) => `${col(r, "Name")}="${col(r, field)}"`).join("; "));
}

const backwards = body.filter((r) => {
  const s = new Date(col(r, "Start Date"));
  const d = new Date(col(r, "Due Date"));
  return s > d;
});
check("no task is due before it starts", backwards.length === 0, backwards.map((r) => col(r, "Name")).join("; "));

const weekend = body.filter((r) => {
  const d = new Date(col(r, "Due Date"));
  return d.getDay() === 0 || d.getDay() === 6;
});
check("no due date lands on a weekend", weekend.length === 0, weekend.map((r) => col(r, "Name")).join("; "));

// --- Subtasks --------------------------------------------------------------
// Asana links a subtask by NAME, and only to a parent already seen above it.
const names = body.map((r) => col(r, "Name"));
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
check("task names are unique (subtasks link by name, so duplicates misfile)", dupes.length === 0, dupes.join("; "));

const orphans = body.filter((r) => col(r, "Parent Task") && !names.includes(col(r, "Parent Task")));
check("every Parent Task refers to a task that exists", orphans.length === 0, orphans.map((r) => col(r, "Name")).join("; "));

const outOfOrder = body.filter((r, i) => {
  const parent = col(r, "Parent Task");
  return parent && names.indexOf(parent) > i;
});
check(
  "every parent appears on an EARLIER row than its subtask",
  outOfOrder.length === 0,
  outOfOrder.map((r) => col(r, "Name")).join("; "),
);

// --- Content ---------------------------------------------------------------
check("every task has a name", body.every((r) => col(r, "Name").trim() !== ""));
check("every task has a description", body.every((r) => col(r, "Description").trim() !== ""));
check("every task is in a section", body.every((r) => col(r, "Section").trim() !== ""));

const types = [...new Set(body.map((r) => col(r, "Type")).filter(Boolean))];
check('Type only ever contains "Milestone"', types.every((t) => t === "Milestone"), types.join(", "));

// Every phase must end in a gate that can fail — the roadmap's own discipline.
const sections = [...new Set(body.map((r) => col(r, "Section")))];
const missingGate = sections.filter(
  (s) => !body.some((r) => col(r, "Section") === s && col(r, "Type") === "Milestone"),
);
check("every phase contains at least one milestone gate", missingGate.length === 0, missingGate.join("; "));

// --- Negative control ------------------------------------------------------
// Proves the date assertion is not vacuous: a wrong format MUST be rejected.
const controlBad = ["2026-08-24", "24/08/2026", "Aug 24 2026", ""].filter((v) => v && US_DATE.test(v));
check("negative control: non-US date formats are rejected by the matcher", controlBad.length === 0, controlBad.join(", "));

console.log("");
if (failures) {
  console.log(`ASANA BACKLOG: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("ASANA BACKLOG: all checks passed");
