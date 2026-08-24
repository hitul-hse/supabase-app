// Gate: the installed agent-skill toolkits stay loadable.
//
// Why this exists. A skill fails in the worst possible way: silently. It sits on
// disk, `ls` shows it, the directory looks perfect -- and `read_skill` reports "no
// skill named X" because V3Code's loader keys its registry off the `name:` field
// in YAML frontmatter, and only ever scans .v3code/skills. Three of the eleven
// everything-claude-code skills shipped with NO frontmatter at all (just an H1),
// so they were unloadable from the moment they landed. Nothing errored.
//
// So this asserts the two things that actually make a skill work, rather than the
// one thing that is easy to check (does the directory exist):
//
//   1. every vendored skill has frontmatter whose `name:` matches its directory
//   2. skills-lock.json records provenance for each vendored source
//
// It deliberately does NOT assert the .v3code/skills mirror or the user-level
// gstack install: both are machine-local and gitignored, so asserting them would
// fail every CI run and in every fresh clone. Those are covered by
// scripts/machine/sync-agent-skills.ps1 and the verification in AGENTS.md.
//
// Run: node scripts/check-agent-skills.mjs

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;

function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`PASS  ${label}${detail ? "  -- " + detail : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}${detail ? "  -- " + detail : ""}`);
  }
}

const REPO = process.cwd();
const CLAUDE_SKILLS = join(REPO, ".claude", "skills");
const AGENTS_SKILLS = join(REPO, ".agents", "skills");
const LOCK = join(REPO, "skills-lock.json");

// ---------------------------------------------------------------- frontmatter

/** Parse `name:` out of a SKILL.md's leading YAML frontmatter. Returns null when
 *  there is no frontmatter block or no name field -- both mean unloadable. */
function frontmatterName(file) {
  const raw = readFileSync(file, "utf8");
  // Tolerate a UTF-8 BOM: a BOM before `---` stops a YAML parser seeing the fence.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (!/^---\r?\n/.test(text)) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  const block = text.slice(4, end);
  const m = block.match(/^name:\s*(\S.*)$/m);
  return m ? m[1].trim() : null;
}

function skillDirs(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => statSync(join(root, n)).isDirectory())
    .sort();
}

const claudeDirs = skillDirs(CLAUDE_SKILLS);
check(".claude/skills exists with skills", claudeDirs.length > 0, `${claudeDirs.length} dirs`);

const missingSkillMd = [];
const missingName = [];
const nameMismatch = [];

for (const d of claudeDirs) {
  const f = join(CLAUDE_SKILLS, d, "SKILL.md");
  if (!existsSync(f)) {
    missingSkillMd.push(d);
    continue;
  }
  const name = frontmatterName(f);
  if (!name) {
    missingName.push(d);
    continue;
  }
  if (name !== d) nameMismatch.push(`${d} declares name:${name}`);
}

check(
  "every .claude/skills dir has a SKILL.md",
  missingSkillMd.length === 0,
  missingSkillMd.length ? missingSkillMd.join(", ") : `${claudeDirs.length} checked`,
);

// The load-bearing one. A skill without `name:` is invisible to the loader.
check(
  "every skill declares name: in frontmatter (loader keys the registry off it)",
  missingName.length === 0,
  missingName.length ? "UNLOADABLE: " + missingName.join(", ") : `${claudeDirs.length} checked`,
);

// A name that disagrees with its directory registers under a name nobody will
// guess -- present, loadable, and unfindable.
check(
  "frontmatter name matches directory name",
  nameMismatch.length === 0,
  nameMismatch.length ? nameMismatch.join("; ") : "no mismatches",
);

// Two names colliding means one silently shadows the other.
const names = claudeDirs
  .map((d) => {
    const f = join(CLAUDE_SKILLS, d, "SKILL.md");
    return existsSync(f) ? frontmatterName(f) : null;
  })
  .filter(Boolean);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
check("no duplicate skill names", dupes.length === 0, dupes.length ? dupes.join(", ") : `${names.length} unique`);

// ------------------------------------------------------- .agents/.claude parity

// .agents/skills holds the canonical copies that .claude/skills mirrors. If they
// drift, an edit to one is silently discarded by the next sync.
const agentDirs = skillDirs(AGENTS_SKILLS);
const onlyClaude = claudeDirs.filter((d) => !agentDirs.includes(d));
const onlyAgents = agentDirs.filter((d) => !claudeDirs.includes(d));
check(
  ".claude/skills and .agents/skills hold the same set",
  onlyClaude.length === 0 && onlyAgents.length === 0,
  onlyClaude.length || onlyAgents.length
    ? `claude-only=[${onlyClaude.join(",")}] agents-only=[${onlyAgents.join(",")}]`
    : `${claudeDirs.length} each`,
);

// ------------------------------------------------------------------- lockfile

check("skills-lock.json exists", existsSync(LOCK));

if (existsSync(LOCK)) {
  const lock = JSON.parse(readFileSync(LOCK, "utf8"));
  const locked = Object.keys(lock.skills ?? {});
  check("lockfile records skills", locked.length > 0, `${locked.length} entries`);

  const bySource = {};
  for (const n of locked) bySource[lock.skills[n].source] = (bySource[lock.skills[n].source] ?? 0) + 1;

  // Every source we vendored should be represented, so a lockfile-driven
  // reinstall restores all of them rather than a silent subset.
  for (const src of ["emilkowalski/skills", "Leonxlnx/taste-skill", "WorldFlowAI/everything-claude-code"]) {
    check(`lockfile has provenance for ${src}`, (bySource[src] ?? 0) > 0, `${bySource[src] ?? 0} skills`);
  }

  const badEntry = locked.filter((n) => {
    const e = lock.skills[n];
    return !e.source || !e.sourceType || !e.skillPath || !/^[0-9a-f]{64}$/.test(e.computedHash ?? "");
  });
  check(
    "every lockfile entry has source, sourceType, skillPath and a sha256",
    badEntry.length === 0,
    badEntry.length ? badEntry.join(", ") : `${locked.length} checked`,
  );

  // A locked skill that is not on disk means the lockfile is describing a state
  // nobody has -- the reinstall path silently no-ops for it.
  const lockedMissing = locked.filter((n) => !claudeDirs.includes(n));
  check(
    "every locked skill is installed on disk",
    lockedMissing.length === 0,
    lockedMissing.length ? "missing: " + lockedMissing.join(", ") : `${locked.length} checked`,
  );
}

// --------------------------------------------------------------------- agents

const AGENTS_DIR = join(REPO, ".claude", "agents");
if (existsSync(AGENTS_DIR)) {
  const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
  check(".claude/agents holds agent files", agentFiles.length > 0, `${agentFiles.length} files`);

  // The nine everything-claude-code subagents, alongside the nine project ones.
  for (const a of ["architect", "code-reviewer", "planner", "security-reviewer", "tdd-guide"]) {
    check(`ECC agent present: ${a}`, agentFiles.includes(`${a}.md`));
  }
}

// ----------------------------------------------------------- sync script + doc

const SYNC = join(REPO, "scripts", "machine", "sync-agent-skills.ps1");
check("sync-agent-skills.ps1 is committed (a clone needs it to load anything)", existsSync(SYNC));

if (existsSync(SYNC)) {
  const sync = readFileSync(SYNC, "utf8");
  // The mirror must read BOTH sources or gstack (user-level only) never loads.
  check("sync script mirrors the user-level install too", /\$HOME|userSrc/.test(sync));
  // Without the exclude list the mirror is 1.2 GB of node_modules and browser bins.
  check("sync script excludes build artefacts", /node_modules/.test(sync) && /excludeDirs/.test(sync));
}

const AGENTS_MD = join(REPO, "AGENTS.md");
if (existsSync(AGENTS_MD)) {
  const doc = readFileSync(AGENTS_MD, "utf8");
  check("AGENTS.md documents the skill routing table", /Skill routing/i.test(doc));
  check("AGENTS.md names the sync script", /sync-agent-skills\.ps1/.test(doc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
