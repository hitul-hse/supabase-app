<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Use the knowledge graph first

This project is mapped into a graphify knowledge graph committed at
`graphify-out/` (6,050 nodes / 8,546 edges / 563 communities, built from
tree-sitter AST so it is deterministic and costs nothing to rebuild).

**Before grepping or opening files to answer a question about this codebase,
query the graph.** It is faster and it returns the connections a grep cannot:

```
graphify query "how does permission checking work on the team lead page?"
graphify explain "getLiveTeamLeadBoard()"      # one symbol and its neighbours
graphify affected "secondsToHours()"           # what breaks if I change this
graphify path "A" "B" --undirected              # how two things connect
graphify god-nodes --top 15                     # the architectural hubs
```

Then fall back to reading files for the specific lines you need to change.
`graphify-out/GRAPH_REPORT.md` is for broad architecture review.

Keeping it current is automatic: a `post-commit` hook rebuilds the graph after
any commit that touches code (AST only, no API key, no cost). If you ever need
it by hand: `graphify update .`

**On a fresh clone the graph does not exist yet — run `graphify update .`
once.** `graph.json` is deliberately not committed (see below), so it is built
locally on first use. It takes well under a minute and costs nothing.

**Neither is automatic in a fresh clone** — `.git/hooks/` and the merge
driver's `git config` half are per-clone and cannot be committed. Run
`graphify hook install` once per machine, and `graphify hook status` to check;
all three lines should read installed/registered. This clone silently had
none of it for a while, and the graph went stale without any symptom other
than answers that quietly described older code.

**On WSL, install graphify natively — do not rely on the Windows binary.**
`graphifyy` on PyPI is pure Python (`uv tool install 'graphifyy[sql]==0.9.48'`,
pinned to match the Windows checkout). The Windows .exe run through WSL can
answer queries, which makes it look fine, but it cannot write: `update`
lowercases paths, so `DESIGN.md` is sought as `design.md` and every
capitalised file fails on a case-sensitive filesystem, aborting the rebuild
with graph.json untouched; and `hook install` shells out to Windows git, which
refuses the `\\wsl.localhost` path as dubious ownership. The `[sql]` extra is
required here — see the note below about the 45 SQL files.

**Neither is automatic in a fresh clone** — `.git/hooks/` and the merge
driver's `git config` half are per-clone and cannot be committed. Run
`graphify hook install` once per machine, and `graphify hook status` to check;
all three lines should read installed/registered. This clone silently had
none of it for a while, and the graph went stale without any symptom other
than answers that quietly described older code.

**On WSL, install graphify natively — do not rely on the Windows binary.**
`graphifyy` on PyPI is pure Python (`uv tool install 'graphifyy[sql]==0.9.48'`,
pinned to match the Windows checkout). The Windows .exe run through WSL can
answer queries, which makes it look fine, but it cannot write: `update`
lowercases paths, so `DESIGN.md` is sought as `design.md` and every
capitalised file fails on a case-sensitive filesystem, aborting the rebuild
with graph.json untouched; and `hook install` shells out to Windows git, which
refuses the `\\wsl.localhost` path as dubious ownership. The `[sql]` extra is
required here — see the note below about the 45 SQL files.

Two things about the setup that are deliberate and should not be "fixed":

- `.graphifyignore` excludes the five vendored agent-skill trees (`.claude/`,
  `.agents/`, `.github/skills/`, `.v3code/`, `agent/skills/`). Without that the
  god-node ranking is dominated by the bundled "impeccable" skill's own helpers
  and the graph describes the tooling instead of this product.
  `.github/workflows/` is deliberately NOT excluded: the CI is ours.
- `graphifyy[sql]` must be installed or the 45 SQL files (including
  `supabase/schema.sql`, i.e. the entire RLS model) parse to nothing, silently.

`GRAPH_REPORT.md`, `manifest.json` and `.graphify_labels.json` are committed on
purpose so every session starts from the same map and the same community names;
`graph.html`, `cache/`, the per-machine pointers and the dated backup
directories are gitignored. Those backups are a local undo buffer written on
every rebuild at ~5MB each — 34MB of them had been committed by accident before
the ignore rule existed.

`graph.json` stopped being committed on 2026-08-31. It is 5.2MB of generated
JSON that the hook rewrites after every code commit, and clustering reshuffles
communities even when the node and edge counts come out identical — so it
landed as a multi-thousand-line diff on unrelated commits, went stale on any
branch that had not been rebuilt, and needed a git merge driver to survive
parallel work. That merge driver is gone with it. Committing
`.graphify_labels.json` is what keeps the local rebuild cheap: the prose
community names come back with it instead of degrading to bare filenames.

## Installed agent toolkits: gstack, everything-claude-code, graphify

Three toolkits are installed and available in every session here. **106 skills
resolve** in total; `read_skill <name>` loads any of them.

Where each one physically lives matters, because it decides what a fresh clone
gets:

| Source | Installed at | Committed? |
| --- | --- | --- |
| gstack (54 skills) | `~/.claude/skills` — user-level | No, deliberately |
| everything-claude-code (11 skills, 9 agents) | `.claude/skills`, `.claude/agents` | Yes |
| graphify (1 skill + CLI 0.9.48) | `.claude/skills/graphify` | Yes |
| emilkowalski / Leonxlnx / impeccable (25) | `.claude/skills` | Yes |

**V3Code's loader only scans `.v3code/skills`** — it does not follow
`.claude/skills`. So a skill can sit on disk with perfect frontmatter and still
be unloadable, with `read_skill` reporting "no skill named X" while the file is
right there. `scripts/machine/sync-agent-skills.ps1` mirrors both sources into
that directory (repo copies win on a name collision). **Run it after any skill
install or update**, and once during new-machine bootstrap.

gstack stays user-level on purpose: it is 6.3 MB of markdown plus 79 bash/bun
scripts, its `SKILL.md` preamble shells out to `~/.claude/skills/gstack/bin/*`
on every single invocation, and its own docs call vendoring deprecated. A repo
copy would be ~25 MB that silently drifts from the copy actually executing.
Its bash layer is verified working here via git bash (`bin/gstack-config`,
`bin/gstack-repo-mode`, `bin/gstack-session-kind` all exit 0); `jq` is absent,
which only disables its optional gbrain detection.

**gstack** (`~/.claude/skills/gstack`, v1.68.3.0, 50+ slash commands) turns the
session into a review/QA/release team. The ones that fit this repo:

| Command | Use it for |
| --- | --- |
| `/investigate` | Any bug. Its Iron Law -- no fix without investigation, stop after 3 failed attempts -- is the discipline that found the dept_head RLS chain rather than guessing at it. |
| `/review` | Before pushing a branch. Reads the diff for SQL safety, trust boundaries, conditional side effects. |
| `/cso` | Anything touching RLS, policies, service-role keys, or the `raw` schema. OWASP + STRIDE. |
| `/qa` | Verifying a deployed change end to end in a real browser. |
| `/plan-eng-review` | Before a migration or a schema change: forces data flow, failure modes and the test matrix into the open. |
| `/office-hours`, `/plan-ceo-review` | New features, before writing code. |
| `/design-review`, `/plan-design-review` | UI work, alongside docs/UI-CONVENTIONS.md. |
| `/retro` | Weekly, to catch drift. |

**everything-claude-code** (vendored into `.claude/skills`, MIT) contributes
`coding-standards`, `backend-patterns`, `frontend-patterns`, `security-review`,
`tdd-workflow`, `verification-loop`, `eval-harness`, `continuous-learning`,
`strategic-compact`, `clickhouse-io` and `project-guidelines-example`. Reach for
`verification-loop` and `eval-harness` when building a new gate;
`security-review` alongside `/cso`. It also adds nine subagents — `architect`,
`build-error-resolver`, `code-reviewer`, `doc-updater`, `e2e-runner`, `planner`,
`refactor-cleaner`, `security-reviewer`, `tdd-guide` — beside the nine existing
project agents in `.claude/agents`.

Three of its skills (`eval-harness`, `project-guidelines-example`,
`verification-loop`) shipped with **no YAML frontmatter at all**, just an H1, so
the loader could never register them. Local copies carry an added `name:` and
`description:`; `skills-lock.json` still records the upstream hash. Audit
frontmatter after any third-party skill install — a missing `name:` fails
silently, which is the worst way for it to fail.

`project-guidelines-example` is a **template for authoring** a project skill,
not guidance for this repo. Its examples describe an unrelated product.

### Skill routing: reach for these by default, not on request

These are installed to be used, so scan for a matching skill BEFORE starting work
rather than after. When one clearly fits, `read_skill` it first — loading a skill
costs one call and changes the shape of the work; skipping it is how you rediscover
something the skill already knows.

| Doing this | Load first |
| --- | --- |
| Any bug, or a fix that already failed once | `/investigate` — no fix without investigation, stop after 3 attempts |
| RLS, policies, service-role keys, the `raw` schema | `/cso` + `security-review` |
| UI, layout, motion, visual polish | `impeccable`, `/design-review`, plus docs/UI-CONVENTIONS.md |
| Writing a new `check-*.mjs` gate | `verification-loop`, `eval-harness` |
| A migration or schema change | `/plan-eng-review` |
| Verifying a deployed change | `/qa` |
| A new feature, before writing code | `/office-hours`, `/plan-ceo-review` |
| "Where is X / how does Y work" in this codebase | `graphify query` (see the top of this file) |
| Server actions, Supabase reads, paged queries | `backend-patterns` |
| React components, client/server boundaries | `frontend-patterns` |
| Before pushing a branch | `/review` |

Skip it for plain conversation, a one-line answer, or a surgical typo fix. Do not
load six skills speculatively — one or two that actually fit beats a stack that
does not.

### These sit ON TOP of this repo's checks, never instead of them

The 120+ `scripts/check-*.mjs` gates are the acceptance criteria here, because
they run against the LIVE database and the DEPLOYED site. A toolkit's opinion is
input; the gate result is the verdict. Concretely:

- `/review` and `/cso` findings still have to survive `node scripts/run-ui-gates.mjs`
  and the relevant `check-*.mjs`. A clean review with a red gate is a red build.
- Nothing from either toolkit may relax the house rules that were paid for in
  incidents: ADR-001 exact-key matching (never name similarity), migrations
  executed in PGlite twice before the user pastes them, `.order()` before
  `.range()` on every paged read, and honest nulls (`n/a`, never a plausible 0).
- `/ship` and `/land-and-deploy` assume a PR flow. This repo commits to master
  and deploys with `npx vercel --prod --yes` because GitHub auto-deploy is
  flaky here. Use them for their review and changelog work, not to change how
  we release.
- gstack's `/browse` wants its own browser binary. The existing Playwright
  gates already drive production with a real magic-link session
  (`check-page-length.mjs` is the reference); prefer those for verification, and
  use `/browse` for exploration.

## UI work: read docs/UI-CONVENTIONS.md first

Any list, table, queue or pager follows docs/UI-CONVENTIONS.md (pagination in
the URL, 10 rows for worked queues, worst-first ordering, honest counts, the
house tokens). The reference implementation is the Pager in
src/app/(app)/customer-master/import-review/page.tsx. Sandbox contributors:
docs/SANDBOX.md.
