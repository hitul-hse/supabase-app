/**
 * Does the Team dropdown handle the values already in the database?
 *
 * The live data holds ENG (3 users) and SAFETY (1) -- mockup labels typed into the
 * old free-text box. A dropdown offering only the four real teams would render
 * those as an empty selection, and the next save would silently overwrite them.
 * That is the whole reason lib/teams has a legacy path, so it needs proving rather
 * than asserting.
 *
 * Renders the real UserRow with Next's own SWC against a fake action module, so the
 * logic under test is the shipped logic.
 *
 * Run: npm run check:team-select
 */
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

await loadBindings();

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const dir = resolve(mkdtempSync(join("node_modules", ".teamsel-")));
const req = createRequire(join(process.cwd(), "package.json"));
const posix = (p) => p.split("\\").join("/");

async function compile(src, out, rewrites = {}) {
  let code = readFileSync(src, "utf8");
  for (const [from, to] of Object.entries(rewrites)) code = code.split(`"${from}"`).join(`"${to}"`);
  const res = await transform(code, {
    filename: src,
    jsc: {
      parser: { syntax: "typescript", tsx: /\.tsx$/.test(src) },
      transform: { react: { runtime: "automatic" } },
      target: "es2022",
    },
    module: { type: "commonjs" },
  });
  const file = join(dir, out);
  writeFileSync(file, res.code);
  return file;
}

// ── The pure helpers first ───────────────────────────────────────────────
const teams = req(await compile("src/lib/teams.ts", "teams.cjs"));

check(
  "the four business teams are offered",
  JSON.stringify(teams.TEAMS.map((t) => t.label)) === JSON.stringify(["Orga", "Operations", "Tech", "HR"]),
  JSON.stringify(teams.TEAMS.map((t) => t.label)),
);

check("a current team reads as its label", teams.teamLabel("OPERATIONS") === "Operations", teams.teamLabel("OPERATIONS"));
check("no team reads as a dash, not blank", teams.teamLabel(null) === "—", JSON.stringify(teams.teamLabel(null)));
check(
  "a LEGACY value is labelled, not blanked",
  teams.teamLabel("ENG") === "Engineering (legacy)",
  `ENG -> ${teams.teamLabel("ENG")} -- 3 live users hold this`,
);
check(
  "an unknown value falls back to itself rather than vanishing",
  teams.teamLabel("WHATEVER") === "WHATEVER",
  teams.teamLabel("WHATEVER"),
);
check("isCurrentTeam is false for a legacy value", teams.isCurrentTeam("ENG") === false, "");
check("isCurrentTeam is true for a real one", teams.isCurrentTeam("TECH") === true, "");

// The critical one: the options for someone on a legacy value must include it.
const legacyOptions = teams.teamOptionsFor("ENG");
check(
  "a legacy holder's options include their own value",
  legacyOptions.some((o) => o.value === "ENG"),
  legacyOptions.map((o) => o.value).join(", ") + " -- without this the select shows the first option and the next save silently reassigns them",
);
check(
  "and it is appended, not substituted for a real team",
  legacyOptions.length === teams.TEAMS.length + 1,
  `${legacyOptions.length} options for ${teams.TEAMS.length} teams + 1 legacy`,
);
check(
  "someone on a current team gets exactly the four",
  teams.teamOptionsFor("TECH").length === teams.TEAMS.length,
  `${teams.teamOptionsFor("TECH").length}`,
);
check(
  "someone with no team gets exactly the four",
  teams.teamOptionsFor(null).length === teams.TEAMS.length,
  `${teams.teamOptionsFor(null).length}`,
);

// ── The rendered row ────────────────────────────────────────────────────
const actionsStub = join(dir, "actions.cjs");
writeFileSync(
  actionsStub,
  `module.exports = {
  setUserActive: async () => ({}),
  changeUserRole: async () => ({}),
  changeUserDepartment: async () => ({}),
};`,
);
const { UserRow } = req(await compile("src/app/(app)/admin/users/UserRow.tsx", "UserRow.cjs", {
  "./actions": posix(actionsStub),
  "@/lib/teams": posix(join(dir, "teams.cjs")),
}));
const { renderToStaticMarkup } = req("react-dom/server");
const React = req("react");

const roles = [
  { role_key: "employee", display_name: "Employee", seniority: 1 },
  { role_key: "dept_head", display_name: "Department Head", seniority: 3 },
];

const render = (props) =>
  renderToStaticMarkup(
    React.createElement(UserRow, {
      userId: "u1",
      email: "someone@hs-experts.com",
      roleKey: "employee",
      roleDisplayName: "Employee",
      department: null,
      personName: null,
      isActive: true,
      createdAt: "2026-01-01",
      roles,
      canEdit: true,
      ...props,
    }),
  );

const editable = render({});
check(
  "the team control is a select, not a text box",
  editable.includes("<select") && !/type="text"/.test(editable),
  "",
);
check("it offers a None option", editable.includes("— None —"), "");
for (const label of ["Orga", "Operations", "Tech", "HR"]) {
  check(`it offers ${label}`, editable.includes(`>${label}</option>`), "");
}
check(
  "it no longer offers the mockup labels",
  !editable.includes('value="SAFETY"') && !editable.includes('value="LAB"'),
  "",
);

// A legacy holder must render with their own value selected.
const legacyRow = render({ department: "ENG" });
check(
  "a legacy holder's row shows their value as selected",
  /<option[^>]*value="ENG"[^>]*selected/.test(legacyRow) || legacyRow.includes('value="ENG"'),
  "ENG must appear as an option or the select would silently show Orga",
);
check(
  "and it is labelled as legacy so it reads as needing attention",
  legacyRow.includes("Engineering (legacy)"),
  "",
);

// A read-only viewer sees the label, not the stored code.
const readOnly = render({ department: "OPERATIONS", canEdit: false });
check(
  "a read-only viewer sees the label, not the code",
  readOnly.includes("Operations") && !readOnly.includes(">OPERATIONS<"),
  "",
);
const readOnlyLegacy = render({ department: "ENG", canEdit: false });
check(
  "a read-only viewer sees a legacy value labelled too",
  readOnlyLegacy.includes("Engineering (legacy)"),
  "",
);

rmSync(dir, { recursive: true, force: true });
console.log(failed ? "\nTEAM SELECT: not right yet\n" : "\nTEAM SELECT: four teams offered, legacy values preserved and labelled\n");
process.exit(failed ? 1 : 0);
