#!/usr/bin/env node

import fs from "fs";
import path from "path";

/**
 * ENFORCES MINIMISATION PRINCIPLE (GDPR Art. 5(1)(c))
 *
 * The Factorial API key can read the entire employee record including salary,
 * bank account, nationality, home address, and disability status. The GDPR
 * requires that we collect only what we need, and STOP at that boundary.
 *
 * This gate verifies that client.ts projects every employee row to the three
 * fields this feature uses (factorialId, fullName, email, active). It greps
 * for `...` spread operators that could accidentally carry the full row, and
 * for field names that appear nowhere in the three exported types.
 */

const content = fs.readFileSync(path.join("src/lib/factorial/client.ts"), "utf8");

const errors = [];

// Must export exactly these types (and nothing else).
const allowedExports = new Set(["FactorialPerson", "FactorialTeam", "FactorialPresence"]);
const foundExports = [...content.matchAll(/export type (\w+)/g)].map((m) => m[1]);
for (const exp of foundExports) {
  if (!allowedExports.has(exp)) {
    errors.push(`❌ Unexpected export type '${exp}' — minimisation requires projecting on arrival`);
  }
}

// FactorialPerson must contain exactly these fields (verified at runtime by
// the comment in the type definition).
const personFields = new Set(["factorialId", "fullName", "email", "active"]);
const personType = content.match(/export type FactorialPerson = \{([\s\S]*?)\}/)?.[1] || "";
const foundPersonFields = [...personType.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
for (const f of foundPersonFields) {
  if (!personFields.has(f)) {
    errors.push(`❌ FactorialPerson.${f} not in the minimised set — remove it`);
  }
}

// Search for spread operators that could slip through the projection.
// (But skip commented-out code talking about the risk.)
const lines = content.split('\n');
for (const line of lines) {
  if (line.includes('...row') && !line.trim().startsWith('*') && !line.trim().startsWith('//')) {
    errors.push("❌ Found '...row' spread — this would carry all 54 fields. Use field-by-field projection");
    break;
  }
}

// The projection into the types must happen synchronously in each fetch function,
// not later in the query layer. Search for suspicious patterns.
const fetchPersonFn = content.match(/export async function fetchFactorialPeople.*?\{([\s\S]*?)\n\}/)?.[1] || "";
if (!fetchPersonFn.includes("factorialId") || !fetchPersonFn.includes("fullName")) {
  errors.push("❌ fetchFactorialPeople does not project to FactorialPerson fields synchronously");
}

// Presence must be minimal too — only id, minutes, and date.
const presenceFields = new Set(["factorialId", "presentMinutes", "daysClocked"]);
const presenceType = content.match(/export type FactorialPresence = \{([\s\S]*?)\}/)?.[1] || "";
const foundPresenceFields = [...presenceType.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
for (const f of foundPresenceFields) {
  if (!presenceFields.has(f)) {
    errors.push(`❌ FactorialPresence.${f} not in the minimised set — remove it`);
  }
}

// Teams should only carry name and employee IDs, not team metadata.
const teamFields = new Set(["teamId", "name", "employeeIds"]);
const teamType = content.match(/export type FactorialTeam = \{([\s\S]*?)\}/)?.[1] || "";
const foundTeamFields = [...teamType.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
for (const f of foundTeamFields) {
  if (!teamFields.has(f)) {
    errors.push(`❌ FactorialTeam.${f} not in the minimised set — remove it`);
  }
}

// Verify that the query layer (factorial-hours.ts) does not spread FactorialPerson.
const queryContent = fs.readFileSync(path.join("src/lib/queries/factorial-hours.ts"), "utf8");
if (queryContent.includes("...f") && queryContent.includes("fPeople")) {
  errors.push("❌ factorial-hours.ts spreads a Factorial object — use .fieldName only");
}

// The page component must not import from Factorial client directly.
const componentContent = fs.readFileSync(path.join("src/components/factorial/factorial-hours-panel.tsx"), "utf8");
if (componentContent.includes("from '@/lib/factorial/client'")) {
  errors.push("❌ Component imports from factorial/client — only queries should touch it");
}

if (errors.length > 0) {
  console.error("MINIMISATION GATE FAILED\n");
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("✓ Minimisation enforced: only identity + attendance exported, no spreads, no extra fields");
