// Test gate for the discovery field inventory.
//
// The inventory decides what DDL gets written, so a bug here produces a wrong
// schema rather than a visible error. Two behaviours are load-bearing enough to
// pin, and both were genuinely broken on the first implementation:
//
//   1. It must flag fields whose UNIT is ambiguous. This repo already stores
//      Factorial in minutes and TrackingTime in seconds, so "assume hours" is a
//      real, previously-made mistake. Matching only full words missed the
//      abbreviations vendors actually ship (`dur`, `hrs`, `qty`).
//   2. It must never print personal data. The field table redacts examples, but
//      the enum section originally printed raw values -- and a small team's
//      emails or names are LOW cardinality, so they classify as an enum and were
//      dumped in full. Redaction in one section is not redaction.
//
// Run: npm run test:discovery
import { buildInventory, classify, renderMarkdown } from "./inventory.mjs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

// --- classification: what decides a Postgres column type -------------------
check("integer vs float are distinguished", classify(5) === "integer" && classify(5.5) === "float");
check("ISO date is not confused with a timestamp",
  classify("2026-08-17") === "date-string" && classify("2026-08-17T09:00:00Z") === "timestamp-string");
check("a numeric string stays a string", classify("12345") === "numeric-string");
check("null is its own class", classify(null) === "null");

// --- a payload carrying every trap we care about ----------------------------
const records = [
  { id: 1,   dur: 3600, hrs: 8,   qty: 2, email: "a@b.com", full_name: "Anna Schmidt", status: "ACTIVE", tags: ["x", "y"], nested: { deep: 1 } },
  { id: "2", dur: null, hrs: 7.5, qty: 1, email: "c@d.com", full_name: "Ben Weber",    status: "DONE",   tags: [],         nested: { deep: 2 } },
  { id: 3,   dur: 1800, hrs: 8,   qty: 3,                   full_name: "Cara Lang",    status: "ACTIVE", tags: ["z"],      nested: { deep: 3 } },
];

const inv = buildInventory({ source: "T", entity: "e", endpoint: "/x", records });
const field = (path) => inv.fields.find((f) => f.path === path);

check("walks into nested objects", Boolean(field("nested.deep")));
check("collapses array elements to one path", Boolean(field("tags[]")),
  "200 tasks should describe one shape, not create 200 paths");

// The ID-numeric-here-string-there trap: a silent join failure later.
check("detects a mixed-type id", field("id").typeConflict === true);

// Unit ambiguity, including the abbreviations that broke this first time.
for (const p of ["dur", "hrs", "qty"]) {
  check(`flags \`${p}\` as needing a unit decision`, field(p).needsUnitDecision === true,
    "assume-hours is the mistake this exists to prevent");
}

// present-and-null and absent-entirely are different vendor statements.
check("distinguishes absent from null",
  field("email").missing === 1 && field("dur").nulls === 1 && field("dur").missing === 0);
check("reports a partial null rate", field("dur").nullRate === 0.333, String(field("dur").nullRate));

check("infers the real enum set from data",
  field("status").likelyEnum === true && field("status").enumValues.join(",") === "ACTIVE,DONE");
check("tracks numeric range", field("dur").numericRange.min === 1800 && field("dur").numericRange.max === 3600);
check("tracks array lengths", field("tags").arrayLengths.min === 0 && field("tags").arrayLengths.max === 2);

// --- the PII gate ----------------------------------------------------------
const md = renderMarkdown(inv);
const secrets = ["a@b.com", "c@d.com", "Anna Schmidt", "Ben Weber", "Cara Lang"];
for (const s of secrets) {
  check(`rendered report never contains "${s}"`, !md.includes(s));
}
check("personal fields are reported as counts only",
  md.includes("Low-cardinality personal fields") && /\d+ distinct values/.test(md));
check("non-personal enums are still printed in full", md.includes("ACTIVE"),
  "redacting everything would make the report useless");

// --- an empty run must not look like a clean one ---------------------------
const empty = buildInventory({ source: "T", entity: "e", endpoint: "/x", records: [] });
check("an empty result warns loudly", empty.warnings.some((w) => w.kind === "no-records"),
  "zero records proves nothing about shape and must not read as success");
check("an empty result has no fields", empty.fieldCount === 0);

console.log(failed ? "\nDISCOVERY INVENTORY: checks failed" : "\nDISCOVERY INVENTORY: all checks passed");
process.exit(failed ? 1 : 0);
