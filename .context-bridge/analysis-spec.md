# HSE Hub – Time Analytics Spec (TrackingTime data)

**Author:** data-analysis agent, 2026-08-20.
**Status:** analysis design only. All numbers below were computed from the LIVE database on 2026-08-20 (read-only, service-role via PostgREST, `Accept-Profile: time`, paged at 1000 rows).

---

## 0. Data reality check (what the data can and cannot support)

Verified against live data:

| Fact | Live value | Consequence |
|---|---|---|
| `time.entry` rows | **5,260** | comfortably enough for monthly/weekly granularity |
| `started_at` / `ended_at` present | **100%** (0 nulls; only 2/2822 tracked entries start at 00:00:00) | **hour-of-day and weekday×hour analyses ARE supported** (contrary to the initial assumption of duration-only) |
| Date span | 2026-01-01 → 2026-12-31 | ~8 months of history + forward-booked entries |
| `is_calendar` split | 2,438 calendar/GHOST entries (3,288.6h) vs 2,822 tracked (5,026.2h) | every "actuals" metric MUST filter `is_calendar = false`; calendar entries are the planning signal |
| Future-dated **tracked** entries (Sep–Dec) | 430.3h, almost all Björn Schönemann pre-logging retainers (AWB 196h, Netto 214.3h) | actuals must ALSO filter `started_at <= today`, not just `is_calendar` |
| `member.team` coverage | only 5/49 members have a team; tracked hours attributable to a team: **1,426.5h vs 3,599.7h with no team** (OPERATIONS 1,394.6h, TECH 31.9h) | **REJECTED: per-team comparison.** With one real team, any "Team A vs Team B" chart is degenerate. Compare per-person, and surface "team" only as an optional badge until backfilled. |
| `member.weekly_hours` | all 49 members = 40 | utilisation denominator is uniform 40h; fine, but per-person capacity nuance is absent |
| Distinct tracked days to date | 162 (2026-01-05 → 2026-08-19), daily org hours min 2 / median 26.9 / max 57.6 | calendar heatmap is dense, non-degenerate |
| Projects with `estimated_hours > 0` | 251/334 (but 32 projects have the placeholder "2h" estimate) | burn % is meaningful for the big projects, noisy for micro-projects |
| Plan-vs-actual overlap | only 25/64 member-weeks (Jul–Aug) have BOTH calendar and tracked time | plan-adherence works for ~5 heavy users only; ship as a per-person diagnostic, not an org KPI |

**Rejected analyses** (data cannot support them):
1. **Team-vs-team comparison** – one populated team (see above).
2. **Billed-vs-unbilled pipeline** – `is_billed` exists but was not exercised (sampled rows all false); revisit after invoicing sync.
3. **Rate/revenue analysis** – no rates in the time schema.
4. **Task-level analysis** – `task_id` exists but tasks add no signal beyond project granularity at this volume.

**Standard "actuals" filter used everywhere below:** `is_calendar = false AND started_at <= now()`.

---

## 1. Ranked analyses

Ranked by value to a managing director. Each includes derivation, live sample numbers (proof of non-degeneracy), chart shape, and placement.

### #1 Month-over-month tracked vs billable hours, with per-person deviation (the core comparison)

**Question:** are we doing more client work than last month, and who moved?

**Derivation:** page `time.entry` (or reuse the app's paged reader in `src/lib/queries/time.ts`), filter actuals, group by `date_trunc('month', started_at)` and `member_id`, sum `duration_seconds`, split by `is_billable`. Compute per-person delta Aug − Jul.

**Live values (Jul → Aug 2026, tracked hours, billable share):**
- Org: 649.0h (82% billable) → 520.5h to date (84% billable). Aug is a partial month, so show run-rate: 520.5h in 14 working days ≈ 781h pace, ahead of Jul.
- Ousmane Fritz Kourouma 169.9h → 113.4h (−56.5)
- Stefan Goelzner 32.5h → 87.8h (+55.3)
- Björn Schönemann 38.6h → 77.2h (+38.6)
- Mustafa Elnabulsieh 77.4h → 101.9h (+24.5)
- Thorsten Krause 68.4h → 0h and Yasemin Basoglu 65.7h → 0h (**both stopped tracking entirely in Aug – exactly the kind of finding this view exists for**)

**Chart:** two-part composition. (a) Org header: **layered dual-tone area** (total tracked as light band, billable as darker band inside it) across all months Jan–Aug. (b) Person detail: **deviation/diverging bar chart**, one row per member, bar = Aug−Jul delta in hours, red left / green right, sorted by delta. A grouped bar (Jul vs Aug side by side per person) is the fallback if diverging bars feel too abstract.

**Placement:** Overview dashboard (org header) + Team Lead page (per-person deviation).

---

### #2 Weekly utilisation vs 40h capacity per person

**Question:** who is over/under-loaded, and is it chronic or a one-week spike?

**Derivation:** actuals grouped by ISO week (Mon start) × member, `hours / weekly_hours`. Show last 8–12 weeks.

**Live values (selected):**
- Ousmane: 105%, 111%, 110%, 73%, 97%, 96%, 91% over the last 7 weeks – **chronically at/over capacity**.
- Mustafa: 38%, 22%, 40%, 71%, **113%**, 76%, 65% – ramping hard.
- Serhii: 60–70% band dropping to 32–44% in Aug.
- Most others sit at 30–50%, which for a consultancy that also does unlogged office work is the "normal band".

**Chart:** **heatmap matrix** – rows = members, columns = ISO weeks, cell colour = utilisation % (diverging scale centred at ~80%, grey for 0). This is the single densest chart the dataset supports. Alternative for a narrative view: **small multiples** of one sparkline-with-threshold-line per person. Reject a single multi-line chart here: 8+ lines crossing 12 weeks is spaghetti.

**Placement:** Team Lead page (primary). A 1-row org-average version belongs on Overview.

---

### #3 Customer concentration and dependency (waffle + Pareto)

**Question:** how dependent is the firm on its top customers?

**Derivation:** actuals grouped by `customer_id` joined to `time.customer`, year to date. Compute cumulative share.

**Live values (YTD, 4,471.5h across 93 active customers):**
1. ENERCON PLM GmbH **1,451.0h = 32%**
2. Hochtief 500.6h (cum 44%)
3. AWB 412.0h (cum 53%)
4. Netto 356.3h (cum 61%)
5. HSE (internal) 333.5h (cum 68%)
- **Top-5 share = 68%.** One customer is a third of all delivered hours. This is the #1 business-risk number in the dataset.

**Chart:** **waffle grid** (10×10, 1 cell = 1% of YTD hours, top customers coloured, long tail grey) – matches the reference-image waffle style and makes "ENERCON is 32 of 100 squares" visceral. Pair with a small **progress-donut** per top-5 customer showing its share. Reject a pie chart with 93 slices.

**Placement:** Overview dashboard (waffle) + Projects page (donuts per customer).

---

### #4 Customer rank trajectory month by month (bump chart)

**Question:** which customers are rising or fading?

**Derivation:** actuals per customer per month, rank top 6, connect ranks across months.

**Live values:** ENERCON is #1 every single month Jan–Aug (112.8h → 256.8h in Jul, still growing). Hochtief oscillates #2–#4 then jumps to a strong #2 in Aug (111.7h, its best month). Intel appears in the top 5 only Apr and Jun. VOI spikes to #3 in Jul (51.8h) then vanishes. Netto re-enters at #3 in Aug. Genuine rank movement exists in every month transition, so the chart is non-degenerate.

**Chart:** **bump/rank chart**, 6 lanes, 8 months, customer logo/label at both ends. Optionally line thickness ∝ hours to prevent rank from hiding magnitude.

**Placement:** Projects page (top) or TrackingTime dashboard.

---

### #5 Weekday × start-hour work-pattern heatmap

**Question:** when does the firm actually work? (Supported: entries carry real timestamps.)

**Derivation:** actuals bucketed by `EXTRACT(dow ...)` × `EXTRACT(hour from started_at)`. Note timezone: stored UTC, entries carry `timezone: GMT+02:00`, so shift +2h for display.

**Live values (tracked hours per cell, UTC):** massive morning peak: Wed 08:00 UTC = **667h**, Thu 08:00 = 486h, Tue 08:00 = 223h, Mon 08:00 = 207h. Fridays are half the volume of Wednesdays. Weekend work is nearly zero (Sat 8h, Sun 6.1h total YTD) – a healthy signal worth showing. Only 2/2,822 tracked entries lack a real start time.

**Chart:** **heatmap calendar-style matrix** (rows Mon–Fri, columns 06:00–20:00 local). Colour scale log or clipped, because the 08:00 spike (largely site visits starting on the hour) would otherwise flatten everything else. A companion **weekly calendar** strip (reference style) can show the current week's actual entries as blocks.

**Placement:** TrackingTime dashboard.

---

### #6 Billable-ratio trend

**Question:** is the share of client-billable work improving?

**Derivation:** actuals per ISO week: `sum(duration_seconds) filter (where is_billable) / sum(duration_seconds)`.

**Live values:** weekly billable % has climbed from a 55–75% band (Feb–May, min 55% w/c May 4) to a stable **78–86% since July** (07-06=86%, 07-13=85%, 08-03=86%, 08-10=84%). That is a real, directional improvement story across 33 weekly points.

**Chart:** **multi-line with markers** – one line for billable %, one for travel % (below), weekly; markers on each point per the reference style. Add a subtle band for the 12-week rolling mean. Dual-axis is NOT needed since both series are percentages; reserve **dual-axis** for the Overview variant that overlays billable % (line, right axis) on total weekly hours (bars, left axis).

**Placement:** Overview dashboard (dual-axis variant) + TrackingTime dashboard (pure line).

---

### #7 Travel-time burden per person

**Question:** how much of each consultant's time is spent driving, and is it paid?

**Derivation:** actuals joined to `time.service` where `is_travel = true` (2 services: Travelltime Payed / unpayed), per member, per period.

**Live values (Jul–Aug):** org travel YTD = 1,128.3h across 979 entries (**22% of all tracked time**). Per person: Mathias Schwenteit **40% travel** (40.4h of 101.8h), Serhii 31%, Ousmane 21%, Björn 21%, vs Thorsten/Yasemin/Stephan 0% (desk-based). Also splits paid vs unpaid: Jul had 56.8h paid vs 59.4h unpaid.

**Chart:** **stacked horizontal bars** per person: [client work | paid travel | unpaid travel | internal], sorted by total. The unpaid-travel segment is the actionable one. Small multiple per month for trend.

**Placement:** Team Lead page.

---

### #8 Project burn: actual vs estimate

**Question:** which engagements are over-running their budget?

**Derivation:** the existing `time.project_summary` view already computes `burn_percent = total/estimated`. Filter `estimated_hours >= 10` to drop the 32 placeholder "2h" projects.

**Live values:** **Netto / 26 SiFa (288h est) is at 398.0h = 138% burn** – already 110h over. Hochtief 26 SiGeKo: 725.3h of 1,196.75h = 60.6% (on pace). AWB 26 SiFA: 552.1h of 1,200h = 46%. 10 projects exceed 100% burn. Caveat to display: several top projects have `estimated_hours = 0` (Enercon site projects, 390.4h and 270.3h with no budget) – show them in a separate "unbudgeted" bucket rather than hiding them.

**Chart:** **progress donuts** (reference style) for the top 6 budgeted projects, ring turning amber >85% and red >100%, centre label = hours remaining. Below, a compact **diverging bar** list: (actual − estimate) hours per project, over-budget to the right.

**Placement:** Projects page (primary), the worst offender as a KPI card on Overview.

---

### #9 Planned vs actual (calendar entries as the plan)

**Question:** does reality follow the schedule?

**Derivation:** per member-week, `sum(duration) filter (is_calendar)` vs `filter (not is_calendar)`, past weeks only. Forward-looking variant: calendar hours after today = booked pipeline (**live: 139h booked for rest of Aug, 50h for Sep**).

**Live values (Jul–Aug):** only 25/64 member-weeks have both a plan and actuals, and adherence is wild: Mathias 78–89% (disciplined planner), Mustafa 61%→368%→800% (plan is decorative), Rency planned 46.3h and tracked 0.5h. Org-level this is noisy, but per-person it is a genuinely useful coaching diagnostic, and the forward-booked pipeline number is solid.

**Chart:** per person, **grouped bars** (plan vs actual, per week) – small multiples per member, only for members with plan data. The pipeline number is a plain KPI card with a mini **layered dual-tone area** (tracked past in solid, calendar future in hatched/lighter tone continuing the same series, split at "today").

**Placement:** Team Lead page (adherence), Overview (pipeline card + area chart). Flag clearly: adherence covers ~5 members today.

---

### #10 Service-mix shift month over month

**Question:** is the type of work changing (Sifa vs SiGeKo vs consulting vs training)?

**Derivation:** actuals grouped by `service_id` × month, joined to `time.service.name`, as % of month.

**Live values (Jul → Aug):** Sifa 208.8h → 190.1h (still #1), SiGeKo 155.0h → 108.8h, **Consulting 85.7h → 106.8h (share rising 13%→21%)**, Risk Assessment 8.5h → 15.8h, training (Grundunterweisung) 7.4h → 0h. Real shifts, ~8–11 services per month.

**Chart:** **100% stacked bars**, one bar per month Jan–Aug, segments = top 6 services + "other". Percent stacking is right here because #1 already shows absolute volume. Reject a bump chart: service ranks barely move; the interesting signal is share, not rank.

**Placement:** TrackingTime dashboard + Projects page.

---

### #11 Engagement fragmentation: projects touched and entry-size distribution

**Question:** who is spread thin, and is time logged in meaningful blocks?

**Derivation:** (a) distinct `project_id` per member per month; (b) histogram of tracked `duration_seconds`.

**Live values:** Mustafa touched **38 projects in Jul, 19 in Aug**; Thorsten 25, Yasemin 33 (vs Ousmane's focused 6). Entry-size distribution: <30m = 685, 30–60m = 493, 1–2h = 956, 2–4h = 308, 4–8h = 289, >8h = 91 entries – a healthy two-mode shape (short admin touches + full site days). The 91 entries >8h are a data-quality review list.

**Chart:** (a) **dot-matrix strip** per member: one dot per project touched this month, coloured by customer – directly answers "spread thin" at a glance and uses the reference dot-matrix idiom. (b) A simple **histogram/bar** for durations (fine as a one-off diagnostic, low dashboard priority).

**Placement:** Team Lead page (a); the >8h outlier list belongs in a data-quality drawer on the TrackingTime dashboard.

---

### #12 Daily activity calendar (org pulse)

**Question:** day-level rhythm and gaps: holidays, site-visit clusters, dead days.

**Derivation:** actuals summed per calendar day; 162 distinct tracked days YTD (2026-01-05 → 2026-08-19), min 2h / median 26.9h / p75 34h / max 57.6h per day.

**Chart:** **GitHub-style heatmap calendar** (months × weekday grid, colour = org hours). Non-degenerate: real variance and visible weekly cadence. Clicking a day drills into the reference-style **weekly calendar** of individual entries (we have real start/end times, so entries render as true time blocks).

**Placement:** TrackingTime dashboard.

---

## 2. Placement summary

| Surface | Analyses |
|---|---|
| **Overview dashboard** | #1 org area + MoM header, #3 customer waffle, #6 dual-axis hours/billable%, #8 worst-burn KPI card, #9 pipeline card |
| **Team Lead** | #1 per-person deviation bars, #2 utilisation heatmap, #7 travel stacked bars, #9 plan-adherence small multiples, #11 project dot-matrix |
| **Projects** | #3 customer donuts, #4 bump chart, #8 burn donuts + diverging bars, #10 service mix |
| **TrackingTime dashboard** | #5 weekday×hour heatmap, #6 billable/travel lines, #10 service mix, #12 activity calendar + weekly calendar drilldown, >8h outlier list |

## 3. Implementation notes for whoever builds this

- **Always filter** `is_calendar = false AND started_at <= now()` for actuals. 430h of future "tracked" retainer pre-logging (mostly one member) will otherwise corrupt every trend.
- PostgREST caps 1000 rows and forbids aggregates: either page `time.entry` (6 requests today) and aggregate in JS as `people-live.ts` already does, or add SQL views per analysis (preferred for #2, #5, #10, #12 – follow the `org_week` pattern).
- August is partial: any MoM comparison must either pro-rate by elapsed working days or compare "first N working days" of both months.
- Display timezone: shift UTC +2h (entries carry `GMT+02:00`).
- Names above are real member names from the live DB; keep the existing RLS/visibility rules when surfacing per-person views.
- Revisit per-team views once `member.team` is backfilled (currently 5/49).
