# Moving this project to a new PC

Everything here is verified against this machine, not assumed. Two scripts do the
work:

| Script | Run on | Purpose |
|---|---|---|
| `scripts/machine/export-machine-state.ps1` | **old** PC | Packages what git cannot carry |
| `scripts/machine/verify-machine-setup.ps1` | **new** PC | Proves the new machine is actually ready |

---

## Before anything else: uncommitted work does not travel

A clone gives you `origin/master` and nothing more. Anything uncommitted, or
committed but unpushed, simply will not exist on the new machine.

```powershell
git status --porcelain        # must be empty (or intentionally abandoned)
git rev-list --count '@{u}..HEAD'   # must be 0
```

The export script warns about both, but it cannot fix them. Push first.

---

## What already travels with `git clone`

More than you would expect, and this was checked rather than assumed:

- **All 24 agent skills.** In this working copy `.claude/skills/*` are Windows
  junctions into `.agents/skills/*`, but git stores them as ordinary files
  (mode `100644`, not `120000`). A fresh clone writes real content — verified:
  24 skill directories, 24 `SKILL.md` files, `animate/SKILL.md` at 11,726 bytes,
  and the directory is **not** a reparse point. **No Developer Mode or elevation
  is required on the new PC.**
- **All 9 project agents** in `.claude/agents`.
- **`.v3code/workspace-id`** — tracked deliberately despite the `.v3code/` ignore
  rule. See "Why memory re-attaches" below.

---

## What does NOT travel — export it

| Item | Location | Size |
|---|---|---|
| `.env.local` | repo root | 5.2 KB, 9 keys |
| `.secrets/` | repo root | GCS service account |
| V3Code memory | `%APPDATA%\V3Code\User\v3code-memory\` | ~87 MB |
| V3Code settings | `%APPDATA%\V3Code\User\settings.json` | 22 KB |
| User agents | `%USERPROFILE%\.v3code\agents\` | 37 agents |
| `docs/discovery/` | repo root | PII — opt in only |

### On the old PC

```powershell
# Close V3Code first (see the WAL warning below).
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\machine\export-machine-state.ps1 -Destination E:\hse-transfer
```

Add `-WhatIf` to preview without writing. Add `-IncludeDiscovery` only if you
genuinely need the PII on the new machine — `docs/discovery/` holds unredacted
colleague names, emails and salary data, and it is re-derivable with
`npm run discovery`.

> **The export contains live credentials in clear text** — service-role key,
> TrackingTime auth, GCS key. Encrypted removable media only. Never email, chat
> or cloud sync. Delete once the new machine verifies.

---

## On the new PC

1. **Node 24.x** and npm. Nothing in `package.json` pins this, so match the major
   manually — PGlite gates have broken on other majors before.
2. `git clone https://github.com/hitul-hse/supabase-app.git`
3. Copy `repo\.env.local` and `repo\.secrets\` into the clone.
4. Copy the V3Code state (**with V3Code closed**):
   - `v3code\v3code-memory\` → `%APPDATA%\V3Code\User\v3code-memory\`
   - `v3code\settings.json` → `%APPDATA%\V3Code\User\settings.json`
   - `v3code\agents\` → `%USERPROFILE%\.v3code\agents\`
5. `npm ci`
6. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\machine\sync-claude-skills.ps1`
   → expect `copied=24`
7. `gh auth login` — the token lives in the Windows keyring and does not travel.
8. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\machine\verify-machine-setup.ps1`
   → expect `fails=0`
9. `npm run lint && npm run test:db && npm run build`

---

## Three things that fail silently

**The memory WAL.** `memory.db` is 61 MB but has a ~5 MB `-wal` sidecar holding
the most recent writes. Copying the `.db` alone loses them with no error — you
would simply find recent memory missing days later. Copy the whole folder, with
V3Code closed so the copy is not torn mid-write.

**Why memory re-attaches at all.** V3Code keys workspace memory by the id in
`.v3code/workspace-id` (`211a04f7-…`), not by folder path. That file is tracked
in git, so the id travels with the clone and memory re-attaches **even if you put
the repo at `D:\Projects\Supabase` instead of `C:\Supabase`**. The verifier
checks for `memory.db` under exactly that id — that is what proves memory
re-attached rather than starting empty under a fresh id.

**The skills mirror is not in git.** V3Code's loader scans `.v3code/skills`, and
`.gitignore` excludes `.v3code/` wholesale. So a clone has the skills in
`.claude/skills` but the loader cannot see them until step 6 regenerates the
mirror. This is exactly why `sync-claude-skills.ps1` lives in `scripts/machine/`
and not in `.v3code/` — a copy kept there would never reach the one machine that
needs it.

---

## Deliberately not transferred

| Item | Why |
|---|---|
| `node_modules/` (0.56 GB) | `npm ci` |
| `.next*`, `tsconfig.tsbuildinfo` | rebuilt |
| `~\.v3code\beastdb` | re-indexes; a stale copy gives wrong search results |
| `~\.v3code\extensions`, `models` (~1.6 GB) | V3Code reinstalls |
| GitHub Actions secrets | server-side; the nightly sync keeps running |
| Supabase config, Google OAuth, RBAC | server-side; unaffected by the move |

The nightly TrackingTime sync at 04:17 UTC runs in GitHub Actions and is
completely independent of which PC you use.

---

## Verified

- `verify-machine-setup.ps1` passes on this machine (`fails=0 warns=1` — the warn
  is `NEXT_PUBLIC_SITE_URL` still on localhost).
- It was proven to **fail** on three injected faults: an env key present but
  empty, a missing skills mirror, and memory not re-attached. A check that cannot
  fail is decoration.
- A real export produced 56 files / 86.7 MB with all three `-wal` sidecars and
  `memory.db` under the correct workspace id.
- A genuine `git clone` into a scratch directory carried 24 skills and 9 agents;
  `sync-claude-skills.ps1` then reported `copied=24`, and the verifier correctly
  reported `NOT READY` for the three things a bare clone legitimately lacks.
