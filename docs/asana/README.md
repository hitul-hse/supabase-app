# Asana backlog import

`hse-platform-backlog.csv` is the platform roadmap as 35 importable Asana tasks — 7 phases,
8 milestone gates, 3 subtasks. It mirrors `docs/architecture/PLATFORM-ARCHITECTURE.md` §7.

## Why a CSV and not the API

Creating these through the Asana API needs a workspace token that isn't in `.env.local`
(`ASANA_ACCESS_TOKEN` is absent). A CSV import needs no token, no app registration and no
admin approval.

If you'd rather it went in via the API, add `ASANA_ACCESS_TOKEN` to `.env.local` and say so —
the generator already produces the exact task shape the API needs.

## How to import

1. Open the **HSE Hub** project in Asana.
2. Click the **▾** next to the project name → **Import** → **CSV**.
3. Choose `docs/asana/hse-platform-backlog.csv`.
4. Click **Make changes** — *don't skip this*. It's the only chance to fix a
   mis-detected column type before the tasks are created.
5. Check that **Due Date** was detected as a date and not as text. If it shows as text,
   something in the file is malformed — run `npm run test:asana-backlog` and re-import.
6. **Continue to project**.

Import **adds** tasks; it never updates existing ones. Importing twice gives you 70 tasks.

## Regenerating

```
npm run asana:backlog        # regenerate the CSV
npm run test:asana-backlog   # verify it against Asana's contract
```

Edit the roadmap in `PLATFORM-ARCHITECTURE.md` first, then mirror it in
`scripts/generate-asana-backlog.mjs` and regenerate — the doc is the source of truth.

To shift the whole schedule, change `START` in the generator. Dates are laid out in
working days, so nothing lands on a weekend.

## The contract this file obeys

Asana fails these **silently** — a malformed date doesn't error, it quietly turns the whole
column into a text custom field, and you find out after 35 tasks are already created.

| Rule | Why |
|---|---|
| `Name` is the first column | Required; Description, Section, Assignee must follow in that order |
| Headers are Title Case | Lowercase headers get treated as custom fields |
| Dates are US `M/D/YYYY` | One bad cell downgrades the entire column to text |
| A parent appears on an earlier row than its subtask | Subtasks link by name, only upward |
| Task names are unique | Duplicates make subtasks attach to the wrong parent |
| Collaborators are comma-separated, no spaces | A space breaks the email match |

`npm run test:asana-backlog` checks all of these plus a negative control, and is wired into
`npm run test:db` so CI runs it.

## Assignees

The `Assignee` column is deliberately empty — assigning requires exact Asana account emails,
and a wrong address silently drops the assignment. Assign in Asana after importing, or tell me
the email addresses and I'll fill the column in.
