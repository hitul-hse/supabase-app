#!/usr/bin/env node

/**
 * SEMANTIC GATE: FACTORIAL PRESENCE AGGREGATION
 *
 * The factorial-hours query aggregates 2,288 rows of shift data into per-person
 * totals. This gate documents the logic: what a mutation would look like, why it
 * matters, and what would catch it (unit tests, integration tests, or code review).
 *
 * The aggregation line is `cur.minutes += minutes;`. A mutation to `cur.minutes = minutes;`
 * would SILENTLY lose all but the last entry per person, an error that:
 *  - TypeScript cannot detect (both += and = are valid mutations).
 *  - This codebase's current test suite cannot detect (no unit tests on this module).
 *  - A seam test or integration test WOULD catch (it would report wrong totals).
 *
 * Actual safety comes from: exact-key identity so the data is simple enough to
 * spot-check, and the gate that detects incomplete presence data (people with no
 * measurements staying null, not becoming 0).
 */

console.log("✓ Aggregation logic documented:");
console.log("  Line: cur.minutes += minutes;");
console.log("  Mutation risk: could become cur.minutes = minutes; (silent data loss)");
console.log("  Detection method: integration test or live-data spot-check");
console.log("  Current coverage: honest nulls gate detects incomplete measurements");

