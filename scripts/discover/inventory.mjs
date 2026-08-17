// Field inventory — turns real vendor payloads into a schema-design report.
//
// Why this exists: a schema designed from vendor documentation and then met with
// real data needs a migration within weeks. The docs under-describe nullability,
// almost never list the real enum set, and say nothing about units. So before any
// DDL gets written we walk actual records and report what is genuinely there.
//
// The output is deliberately a REPORT, not a schema. It tells you, per field
// path: the observed types, how often it is null or missing, how many distinct
// values it takes, and real examples. You read that and then design.
//
// Three things this is built to catch, because each has silently broken a
// warehouse before:
//   - a field the docs call required that is null in practice
//   - an ID that is numeric in one endpoint and a string in another
//   - a unit that isn't hours (this repo already stores Factorial in MINUTES and
//     TrackingTime in SECONDS -- see weekly_employee_summary)
//
// No network access and no vendor specifics live here, so it is testable on
// fixtures and shared by every connector.

/** Values with more distinct entries than this are treated as free text, not an enum. */
const ENUM_CEILING = 25;
/** Keep at most this many examples per field, so a report stays readable. */
const MAX_EXAMPLES = 3;
/** Guard against a pathological payload turning one field into thousands of paths. */
const MAX_ARRAY_SAMPLE = 50;

/**
 * Field-name fragments that suggest a unit we must pin down before modelling.
 * Includes the short forms vendors actually use (`dur`, `qty`, `hrs`) — matching
 * only the full word missed `dur` on a real payload.
 */
const UNIT_HINTS = [
  "duration", "dur", "hours", "hour", "hrs", "minutes", "minute", "mins",
  "seconds", "second", "secs", "time", "amount", "price", "rate", "cost",
  "budget", "salary", "value", "qty", "quantity", "total", "balance",
];

/** Field-name fragments that suggest personal data, so a report can be scrubbed. */
const PII_HINTS = [
  "email", "name", "phone", "mobile", "address", "street", "city", "zip",
  "postcode", "iban", "bic", "tax", "ssn", "birth", "dob", "salary", "photo",
  "avatar", "picture", "passport", "nationality",
];

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Classify a value more usefully than `typeof` does.
 * Distinguishing an integer from a float and an ISO date from a plain string is
 * exactly what decides a Postgres column type.
 */
export function classify(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isPlainObject(value)) return "object";
  const t = typeof value;
  if (t === "number") return Number.isInteger(value) ? "integer" : "float";
  if (t === "boolean") return "boolean";
  if (t === "string") {
    if (value === "") return "empty-string";
    // Ordering matters: a full timestamp also matches the date prefix.
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return "timestamp-string";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date-string";
    if (/^-?\d+$/.test(value)) return "numeric-string";
    if (/^-?\d*\.\d+$/.test(value)) return "decimal-string";
    return "string";
  }
  return t;
}

/**
 * Walk one record, accumulating per-path stats into `fields`.
 * Array elements collapse to a single `path[]` entry: 200 tasks should describe
 * one shape, not create 200 paths.
 */
function walk(node, path, fields, depth = 0) {
  if (depth > 12) return; // vendor payloads shouldn't nest this deep; stop rather than hang

  if (Array.isArray(node)) {
    const entry = ensure(fields, path);
    entry.arrayLengths.push(node.length);
    for (const item of node.slice(0, MAX_ARRAY_SAMPLE)) {
      walk(item, `${path}[]`, fields, depth + 1);
    }
    return;
  }

  if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      walk(value, path ? `${path}.${key}` : key, fields, depth + 1);
    }
    return;
  }

  observe(ensure(fields, path), node);
}

function ensure(fields, path) {
  let entry = fields.get(path);
  if (!entry) {
    entry = {
      path,
      seen: 0,
      nulls: 0,
      empties: 0,
      types: new Map(),
      distinct: new Set(),
      distinctOverflowed: false,
      examples: [],
      arrayLengths: [],
      min: null,
      max: null,
    };
    fields.set(path, entry);
  }
  return entry;
}

function observe(entry, value) {
  entry.seen += 1;
  const type = classify(value);
  entry.types.set(type, (entry.types.get(type) ?? 0) + 1);

  if (value === null) {
    entry.nulls += 1;
    return;
  }
  if (value === "") {
    entry.empties += 1;
    return;
  }

  if (typeof value === "number") {
    entry.min = entry.min === null ? value : Math.min(entry.min, value);
    entry.max = entry.max === null ? value : Math.max(entry.max, value);
  }

  // Cap the distinct set: without this a free-text field on a large account
  // holds every value in memory for no benefit.
  if (entry.distinct.size <= ENUM_CEILING) {
    entry.distinct.add(typeof value === "object" ? "[object]" : String(value));
  } else {
    entry.distinctOverflowed = true;
  }

  if (entry.examples.length < MAX_EXAMPLES) {
    const shown = typeof value === "string" && value.length > 80
      ? `${value.slice(0, 77)}...`
      : value;
    if (!entry.examples.includes(shown)) entry.examples.push(shown);
  }
}

const hints = (path, list) => {
  const lower = path.toLowerCase();
  return list.some((h) => lower.includes(h));
};

/**
 * Build an inventory from an array of records fetched from one endpoint.
 *
 * `recordCount` is tracked separately from per-field `seen` on purpose: a field
 * absent from a record is *missing*, which is a different fact from being
 * present-and-null, and vendors mean different things by the two.
 */
export function buildInventory({ source, entity, endpoint, records }) {
  const fields = new Map();
  for (const record of records) walk(record, "", fields, 0);

  const total = records.length;

  const inventory = [...fields.values()]
    .map((entry) => {
      const present = entry.seen;
      const missing = Math.max(0, total - present);
      const types = [...entry.types.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count }));

      const nonNullTypes = types.filter(
        (t) => t.type !== "null" && t.type !== "empty-string",
      );

      return {
        path: entry.path,
        present,
        missing,
        missingRate: total ? +(missing / total).toFixed(3) : 0,
        nulls: entry.nulls,
        nullRate: present ? +(entry.nulls / present).toFixed(3) : 0,
        empties: entry.empties,
        types,
        // More than one non-null type is the ID-numeric-here-string-there trap.
        typeConflict: nonNullTypes.length > 1,
        distinctCount: entry.distinctOverflowed ? `>${ENUM_CEILING}` : entry.distinct.size,
        likelyEnum:
          !entry.distinctOverflowed &&
          entry.distinct.size > 0 &&
          entry.distinct.size <= ENUM_CEILING &&
          nonNullTypes.every((t) => t.type === "string"),
        enumValues:
          !entry.distinctOverflowed && entry.distinct.size <= ENUM_CEILING
            ? [...entry.distinct].sort()
            : null,
        numericRange: entry.min === null ? null : { min: entry.min, max: entry.max },
        arrayLengths: entry.arrayLengths.length
          ? {
              min: Math.min(...entry.arrayLengths),
              max: Math.max(...entry.arrayLengths),
            }
          : null,
        needsUnitDecision: hints(entry.path, UNIT_HINTS),
        likelyPii: hints(entry.path, PII_HINTS),
        examples: entry.examples,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    source,
    entity,
    endpoint,
    generatedAt: new Date().toISOString(),
    recordCount: total,
    fieldCount: inventory.length,
    fields: inventory,
    warnings: collectWarnings(inventory, total),
  };
}

/**
 * Surface the findings that change a schema decision, so they aren't buried in
 * a long field list.
 */
function collectWarnings(inventory, total) {
  const warnings = [];

  if (total === 0) {
    warnings.push({
      kind: "no-records",
      message:
        "No records returned. An empty inventory proves nothing about the shape — " +
        "check credentials, filters and date ranges before trusting this run.",
    });
    return warnings;
  }

  for (const f of inventory) {
    if (f.typeConflict) {
      warnings.push({
        kind: "type-conflict",
        path: f.path,
        message: `Mixed non-null types (${f.types.map((t) => t.type).join(", ")}). Pick one Postgres type and normalise on ingest.`,
      });
    }
    if (f.needsUnitDecision) {
      warnings.push({
        kind: "unit-unclear",
        path: f.path,
        message:
          "Looks like a quantity — confirm the unit before modelling. This repo already " +
          "stores Factorial in minutes and TrackingTime in seconds, so hours is not a safe default.",
      });
    }
    if (f.nullRate > 0 && f.nullRate < 1) {
      warnings.push({
        kind: "sometimes-null",
        path: f.path,
        message: `Null in ${Math.round(f.nullRate * 100)}% of records — the column must be nullable regardless of what the docs say.`,
      });
    }
    if (f.missingRate > 0) {
      warnings.push({
        kind: "sometimes-absent",
        path: f.path,
        message: `Absent from ${Math.round(f.missingRate * 100)}% of records (different from present-and-null).`,
      });
    }
    if (f.likelyPii) {
      warnings.push({
        kind: "pii",
        path: f.path,
        message: "Personal data — scrub before committing any sample payload to the repo.",
      });
    }
  }

  return warnings;
}

/** Render an inventory as Markdown for a human reviewer. */
export function renderMarkdown(inv) {
  const lines = [];
  lines.push(`# ${inv.source} — ${inv.entity}`);
  lines.push("");
  lines.push(`- Endpoint: \`${inv.endpoint}\``);
  lines.push(`- Records sampled: **${inv.recordCount}**`);
  lines.push(`- Distinct field paths: **${inv.fieldCount}**`);
  lines.push(`- Generated: ${inv.generatedAt}`);
  lines.push("");

  const byKind = new Map();
  for (const w of inv.warnings) {
    if (!byKind.has(w.kind)) byKind.set(w.kind, []);
    byKind.get(w.kind).push(w);
  }

  if (byKind.size) {
    lines.push("## Decisions needed before writing DDL");
    lines.push("");
    for (const [kind, list] of byKind) {
      lines.push(`### ${kind} (${list.length})`);
      lines.push("");
      for (const w of list.slice(0, 40)) {
        lines.push(`- ${w.path ? `\`${w.path}\` — ` : ""}${w.message}`);
      }
      if (list.length > 40) lines.push(`- …and ${list.length - 40} more`);
      lines.push("");
    }
  }

  lines.push("## Fields");
  lines.push("");
  lines.push("| Path | Types | Null | Missing | Distinct | Examples |");
  lines.push("|---|---|---|---|---|---|");
  for (const f of inv.fields) {
    const types = f.types.map((t) => t.type).join(" / ");
    const ex = f.likelyPii
      ? "_(pii — withheld)_"
      : f.examples.map((e) => `\`${String(e)}\``).join(", ");
    lines.push(
      `| \`${f.path}\` | ${types} | ${Math.round(f.nullRate * 100)}% | ${Math.round(f.missingRate * 100)}% | ${f.distinctCount} | ${ex} |`,
    );
  }
  lines.push("");

  // PII fields are excluded here, not just redacted: a low-cardinality personal
  // field (a small team's emails, a short list of names) is classified as an
  // enum, and printing its values would dump exactly the data the field table
  // withholds two sections earlier.
  const enums = inv.fields.filter((f) => f.likelyEnum && f.enumValues?.length && !f.likelyPii);
  if (enums.length) {
    lines.push("## Observed enum values");
    lines.push("");
    lines.push("_Observed, not documented. Treat any value outside these as possible but unseen._");
    lines.push("");
    for (const f of enums) {
      lines.push(`- \`${f.path}\`: ${f.enumValues.map((v) => `\`${v}\``).join(", ")}`);
    }
    lines.push("");
  }

  const piiEnums = inv.fields.filter((f) => f.likelyEnum && f.enumValues?.length && f.likelyPii);
  if (piiEnums.length) {
    lines.push("## Low-cardinality personal fields");
    lines.push("");
    lines.push("_Values withheld — these look like personal data. Counts only._");
    lines.push("");
    for (const f of piiEnums) {
      lines.push(`- \`${f.path}\`: ${f.enumValues.length} distinct values`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
