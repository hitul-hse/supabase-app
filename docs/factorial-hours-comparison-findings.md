# Factorial ↔ TrackingTime hours comparison — measured findings

Everything here was measured against the live Factorial API and the live database
on 2026-08-28, not inferred from documentation. Numbers are reproducible with the
scripts named at each point.

## 1. The API works, and two of its behaviours will bite

`FACTORIAL_API_KEY` in `.env.local` authenticates. Company 157774, token valid to
2035-12-09.

**`filter[date][gte]` is accepted and silently ignored.** Requesting
`/resources/attendance/shifts?filter[date][gte]=2026-06-01&filter[date][lte]=2026-08-28`
returns **HTTP 200 with all 20,929 shifts**, of which only 2,288 are in range.
That is the dangerous failure: a success status with the wrong rows. A sync built
on it would silently aggregate three years of attendance into a 90-day figure.

**`start_on` / `end_on` works.** Same window returns exactly 2,288 rows, and in
7s rather than 23s.

**`limit` is ignored and `paginateable: false`.** The endpoint returns the whole
filtered set in one response, so there is no paging to do — requests must be
bounded by DATE, not by page size.

## 2. Attendance data is real and current

- 20,929 shifts total, earliest 2023-02-01
- 2,288 in the last 90 days, across 67 distinct days and 23 employees
- Fields: `employee_id`, `date`, `clock_in`, `clock_out`, `minutes`

`minutes` is the usable per-person, per-day figure.

## 3. Identity resolves for 16 of 20 active people

Exact normalised email against `time.member.email` (ADR-001: no similarity
matching). 15 via email, 1 via display_name (Hendryk Arndt).

**`public.people.factorial_employee_id` already exists** and is null for all 26
rows. That is the intended join column, so linking needs no migration.

Unresolved, and needing a review-queue row rather than a guess:
Emilia Monica Kamsi, Leonie Roitsch, Alexander Mense, Nataliia Karpinska.
All four DO clock attendance (377h, 493h, 32h, 481h in 90 days), so they are real
staff who simply do not appear in TrackingTime.

## 4. Presence and logged time are DIFFERENT quantities

This is the central design constraint. Measured over 90 days:

| person | present | logged | billable | gap |
|---|---|---|---|---|
| Mustafa Elnabulsieh | 593.7 | 387.0 | 294.8 | +206.7 |
| Hitul Shah | 468.5 | 2.8 | 2.8 | +465.7 |
| Kurt Wienholz | 420.3 | 1.3 | 1.3 | +419.0 |
| Simone Schönemann | 401.5 | 0.0 | 0.0 | +401.5 |
| Ousmane Fritz Kourouma | 418.6 | 410.3 | 329.6 | +8.3 |
| Stephan Herrmann | 141.7 | 219.1 | 145.7 | **−77.4** |
| Rency Sebastian | 354.9 | 482.8 | 43.3 | **−127.9** |
| Björn Schönemann | **0.0** | 276.0 | 231.5 | — |

Three things follow:

- **A gap is normal.** Breaks, admin, travel and meetings are presence without a
  logged task. A panel presenting the gap as unaccounted time would be accusing
  people of something the data does not show.
- **The gap goes NEGATIVE.** Stephan and Rency logged more task time than they
  were clocked in for, which is what happens when work is logged for days
  somebody never clocked. So this cannot be modelled as "presence ≥ logged".
- **Björn clocked 0.0h while logging 276h.** He does not use attendance. His
  figure must read *not clocked*, never 0h, or the most senior person in the
  company appears to have done nothing.

## 5. "Operations" is a hub concept, and the hub data is incomplete

There is no Operations team in Factorial. Its six teams are Safety (16), Admin
(13), Management (8), Health (1), Tech (3), Sales/Marketing (2).

The hub has `people.department`, but it is **incomplete**:

| department | active people |
|---|---|
| *(none)* | **8** — Azubuike, Hendryk, Mathias, Mustafa, Ousmane, Rency Sebastian, Serhii, Stephan |
| ORGA | 4 |
| OPERATIONS | **3** — Björn, Thorsten, Yasemin |
| TECH | 2 |
| ENG | 1 |

**This is the finding that most affects the request.** Filtering by
`department = 'OPERATIONS'` yields 3 people. But the 8 with no department include
Mathias, Ousmane, Stephan, Hendryk and Mustafa — the highest-logging consultants,
all of them in Factorial's Safety Team. Whatever the user means by "the
operations team", it is not the 3 people the hub labels OPERATIONS.

So the dashboard must not silently scope to `OPERATIONS`. It should show the
department it is scoping by, state how many people have no department, and let
the reader see the Safety Team as the cross-check. Picking one and hiding the
disagreement would answer a different question from the one asked.

## 6. Data minimisation is a code constraint, not a note

The employees endpoint returns 54 fields per person. The comparison needs 7
(`id`, names, `email`, `active`, `company_id`). The other 47 include 14 populated
sensitive fields: `bank_number`, `swift_bic`, `birthday_on`, `nationality`,
`disability_percentage_cents`, home address, personal phone. `contract_versions`
is also readable with `salary_amount` populated.

An API key in Factorial is all-or-nothing — there is no scope to narrow. So the
minimisation has to happen in our code: select only identity fields, never
persist the rest, never log a whole record. A gate must enforce this, because a
future `select *` would quietly start storing bank details.

## 7. LOGGED is not a duration — measured, and it changes the design

An adversarial review raised this and it turned out to be real. PRESENT is
wall-clock occupancy (clock in/out). LOGGED is a SUM of task durations, which is
only a duration if entries do not overlap. They do.

**308.6h double-counted across 12 people in 90 days.** Per-person inflation of
the naive SUM against the true union of intervals:

| person | sum | true span | inflation |
|---|---|---|---|
| Rency Sebastian | 482.8 | 372.1 | **+29.8%** |
| Thorsten Krause | 278.4 | 227.1 | **+22.6%** |
| Pablo Guerra Ares | 106.1 | 92.8 | +14.3% |
| Mustafa Elnabulsieh | 387.0 | 344.8 | +12.2% |
| Serhii Vylianskyi | 408.7 | 372.2 | +9.8% |
| Björn Schönemann | 276.0 | 260.2 | +6.1% |
| Mathias Schwenteit | 426.4 | 423.5 | +0.7% |
| Stephan Herrmann | 219.1 | 219.0 | none |

Two physically impossible rows exist: a **59.1h single entry** and a **69.6h
person-day**, both Rency. The 59.1h row is a CALENDAR entry spanning Mon→Wed
whose duration equals its span, so it is a multi-day calendar block rather than a
typed mistake.

**The cause is mostly benign, which is the useful part.** Of the overlapping
pairs, 375 (263.0h) involve a calendar entry and only 80 (45.6h) are two real
work entries. Calendar placeholders sit on top of real work by design, and the
app already excludes them from headline figures via `is_calendar` — the
TrackingTime dashboard defaults to excluding calendar time for exactly this
reason.

So:

- Excluding calendar entries removes roughly 85% of the double-count.
- The residual 45.6h of genuinely concurrent work still means LOGGED is not
  exactly a duration, so **PRESENT − LOGGED must not be presented as
  "unaccounted time"**.
- Rency at +29.8% is not a rounding artefact. Any per-person figure for Rency
  computed as a naive sum is wrong by nearly a third.

**Design consequence.** Show PRESENT and LOGGED side by side as two
independently sourced measures, and do not headline their difference. Where a
comparison is shown, compute LOGGED as the union of non-calendar intervals
rather than `SUM(duration_seconds)`.

## 8. What the user actually asked for, restated against the data

The user's own framing: *"factorial is our HR tool so we use it to just track our
regular working hours, and trackingtime we use it for tracking billable or
non-billable hours in clients projects"*.

That maps cleanly onto the measurements and is narrower than a generic "gap"
analysis:

| quantity | source | meaning |
|---|---|---|
| regular working hours | Factorial attendance `minutes` | contracted presence |
| billable | `time.entry` where `is_billable` | client-chargeable work |
| non-billable | `time.entry` where not billable, not calendar | real work, not chargeable |

The honest headline is therefore **billable share of tracked project work**, with
Factorial presence shown alongside as the HR-side reference — not subtracted from
it.
