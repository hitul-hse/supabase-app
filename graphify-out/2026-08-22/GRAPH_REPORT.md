# Graph Report - Supabase  (2026-08-22)

## Corpus Check
- 429 files · ~478,299 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2858 nodes · 4447 edges · 240 communities (200 shown, 40 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 63 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7bb14cb4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- scripts
- Standalone Runtime Bootstrap
- Roles & Permissions Schema
- users/actions.ts
- AuthShell.tsx
- projects/actions.ts
- nav-icons.tsx
- check-time-integration.mjs
- Design System Check
- TypeScript Config Includes
- trackingtime-report.ts
- devDependencies
- people-live.ts
- Schema Apply Checks
- team-lead-live.ts
- Brand Mark Verifier
- Inventory Generation
- Org Chart Edit Check
- time/page.tsx
- time.ts
- AnalyticsCharts.tsx
- Vendor Parity Check
- Dashboard Claims Recheck
- time/actions.ts
- TeamLeadBoard.tsx
- profile/actions.ts
- projects-live.ts
- People Overview Agreement Check
- InsightPanels.tsx
- ReportTables.tsx
- check-overview-range-narrows.mjs
- MyLeavePanel.tsx
- (app)/page.tsx
- TimesheetGrid.tsx
- Sidebar Collapse Check
- Time Page Render Check
- Missing Events Diagnosis
- overview-live.ts
- Paging & RLS Recheck
- PeopleDirectory.tsx
- Asana Backlog Check
- Time Acceptance Tests
- label
- types.ts
- Dashboard Tables Check
- TrackingTime Parity Check
- Charts.tsx
- Sidebar.tsx
- OAuth Success Path Check
- People Live Source Check
- check-overview-filters.mjs
- (app)/layout.tsx
- No Mock People Check
- Server Action Auth Check
- ProjectsExplorer.tsx
- Marketing Demo Page
- measure-latency-variance.mjs
- Identity Linking Check
- No Mock Data Check
- TrackingTime Sync Script
- TimerBar.tsx
- Invite OAuth Model Check
- OAuth Callback Check
- Time Member Linking
- Marketing Video Page
- Admin User Writes Check
- Deployed Overview Check
- Profile RLS Check
- Sync & Drilldown Check
- Trend Window Check
- User Management Check
- Hours Definitions Explainer
- Asana Backlog Generator
- Dashboard Cost Measurement
- check-people-filters-live.mjs
- try-policy-verification-paths.mjs
- Entry Policy Equivalence Check
- OnboardingTour.tsx
- Profile Actions Check
- people/actions.ts
- Stale Total Tracing
- apply-rls-hoisting.mjs
- Agent File References Check
- Approval Error Handling Check
- Org Chart Check
- Schema Execution Check
- Time Write Path Check
- Member Provisioning Script
- check-duration-parsing.mjs
- Google Client Check
- Schema Order Check
- SSO Provider Check
- Time Org Chart View Check
- Agent Claim Recheck
- Loading Skeletons
- ReportPanels.tsx
- Agent Claims Check
- Dashboard Acceptance Check
- Economics Scope Check
- Lint Scope Check
- Login Redirect Safety Checks
- OAuth Success Path Verification
- Page Length Render Check
- Parallel Paging Performance Test
- Permissions RLS Parity Check
- Provisioned Access Verification
- Remote Deploy State Check
- RLS Query Hoisting Benchmark
- User Management UI Check
- TrackingTime Integration Check
- AI Provider Credential Probes
- Deployment Wait Helper
- Root Layout And Fonts
- Auth Route Gate Checks
- Charts UI Check
- Live Dashboard Check
- People And Filters UI Check
- Records Tabs Source Check
- Redirect Allowlist Check
- Team Analysis UI Check
- Theme And Figures Check
- Google OAuth Error Diagnosis
- check-trackingtime-report.mjs
- ThemeToggle.tsx
- Auth Session Middleware
- Live Database Audit
- Profile Grants Check
- Project Write Auth Check
- Records Tabs UI Check
- Redirect Guard Logic Check
- Time Page Live Readiness
- Time Page Data Check
- Policy Verification Query Check
- Null Assignments Diagnosis
- Migration Module Generator
- OAuth Invite Linking Proof
- Economics Access Recheck
- Demo Video Recorder
- Sync Secrets Setup
- Yearly Screenshot Capture
- Policy Gate Failure Verification
- permissions.ts
- CI Workflow Check
- Deploy Skew Check
- Modules RLS Check
- OAuth Diagnosis Check
- Permission Enforcement Check
- Production Config Check
- RLS Behaviour Check
- Sync Freshness Check
- Backend Agent Grading
- Testing Agent Grading
- Live RLS Probe
- Anonymous Write Verification
- createClient
- Next.js Build Config
- Profile Column Guard Trigger
- Middleware Bypass Check
- Profile Action Auth Check
- Time Analytics Check
- Frontend Agent Grading
- Machine State Export
- Requirements Traceability Run
- Provider Status Endpoint
- Member Hierarchy Migration
- Member Utilisation Bounding
- Project Sections And Tasks
- Dashboard Tile Apply
- Backslash Redirect Check
- Member Hierarchy Migration Check
- Open Redirect Check
- Policy Count Control Check
- OAuth Config Diagnosis
- Live Database Inspection
- OpenAI API Probe
- Gemini Key Setup
- Window Tabs
- Org Chart Schema
- ESLint Configuration
- MCP Server Config
- Pager Build Package Manifest
- Skew Check Build Manifest
- Tabs Build Package Manifest
- UM Check Build Manifest
- PostCSS Configuration
- Eval Rerun Grading Script
- Project Timeline Model
- User Profile Table
- time-dashboard.ts
- Time Member Model
- check-people-module.mjs
- dashboard/page.tsx
- PortfolioCharts.tsx
- read-prod-total.mjs
- AGENTS.md
- database.types.ts
- ReportFilters.tsx
- check-hr-role-migration.mjs
- hse.ts
- check-projects-module.mjs
- BudgetPanel.tsx
- public.overbooking_alert
- TeamLeadExplorer.tsx

## God Nodes (most connected - your core abstractions)
1. `scripts` - 138 edges
2. `createClient()` - 86 edges
3. `secondsToHours()` - 35 edges
4. `get()` - 23 edges
5. `getLiveOverview()` - 23 edges
6. `createRuntime()` - 22 edges
7. `TrackingTimeDashboardPage()` - 20 edges
8. `include` - 19 edges
9. `userHasPermission()` - 18 edges
10. `PERMISSIONS` - 17 edges

## Surprising Connections (you probably didn't know these)
- `render()` --indirect_call--> `UserRow()`  [INFERRED]
  scripts/check-team-select.mjs → src/app/(app)/admin/users/UserRow.tsx
- `app_user_role_v2()` --reads_from--> `app_user_profile`  [EXTRACTED]
  scripts/eval/reports-module.sql → supabase/schema.sql
- `CustomerPortfolio` --calls--> `secondsToHours()`  [EXTRACTED]
  src/lib/queries/projects-live.ts → src/lib/time-transform.ts
- `CustomerRankByMonth` --calls--> `secondsToHours()`  [EXTRACTED]
  src/lib/queries/projects-live.ts → src/lib/time-transform.ts
- `main()` --calls--> `classifyService()`  [EXTRACTED]
  scripts/import-trackingtime.mjs → src/lib/time-transform.ts

## Import Cycles
- None detected.

## Communities (240 total, 40 thin omitted)

### Community 0 - "scripts"
Cohesion: 0.01
Nodes (138): scripts, apply-modules, asana:backlog, build, check:acceptance, check:action-auth, check:admin-user-writes, check:avatar (+130 more)

### Community 1 - "Standalone Runtime Bootstrap"
Cohesion: 0.06
Nodes (75): boot(), bundledBlob(), cdnScriptFor(), collectProps(), compileAttr(), compileTemplate(), contentKey(), createComponentFactory() (+67 more)

### Community 2 - "Roles & Permissions Schema"
Cohesion: 0.05
Nodes (55): auth, app_user_role_v2(), can_view_report(), people, reports, app_module, app_permission, app_role_permission (+47 more)

### Community 3 - "users/actions.ts"
Cohesion: 0.05
Nodes (59): actionsStub, dir, editable, legacyOptions, legacyRow, React, readOnly, readOnlyLegacy (+51 more)

### Community 4 - "AuthShell.tsx"
Cohesion: 0.19
Nodes (14): ForgotPasswordPage(), LoginForm(), safeRedirect(), SetPasswordForm(), authButtonClass, AuthHeading(), authInputClass, authLabelClass (+6 more)

### Community 5 - "projects/actions.ts"
Cohesion: 0.15
Nodes (20): addComment(), addSubtask(), createSection(), createTask(), CreateTaskState, deleteComment(), deleteTask(), insertTask() (+12 more)

### Community 6 - "nav-icons.tsx"
Cohesion: 0.10
Nodes (7): IconDot(), IconProps, IconSearch(), NAV_ICONS, NAV_GROUPS, NavGroup, SidebarNav()

### Community 7 - "check-time-integration.mjs"
Cohesion: 0.11
Nodes (13): alias, anon, days, dir, env, queries, require, supabase (+5 more)

### Community 8 - "Design System Check"
Cohesion: 0.05
Nodes (43): APP_SHELL, authInput, authShell, buttonSrc, card, chartsSrc, check(), chrome (+35 more)

### Community 9 - "TypeScript Config Includes"
Cohesion: 0.05
Nodes (40): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next-flake-probe/dev/types/**/*.ts, .next-flake-probe/types/**/*.ts (+32 more)

### Community 10 - "trackingtime-report.ts"
Cohesion: 0.18
Nodes (17): BudgetRow, DEFAULT_FILTERS, fetchAllEntries(), fetchExcludedCalendarSeconds(), FetchResult, FilterOptions, getFilterOptions(), GroupRow (+9 more)

### Community 11 - "devDependencies"
Cohesion: 0.05
Nodes (37): @electric-sql/pglite, eslint, eslint-config-next, framer-motion, next, dependencies, framer-motion, next (+29 more)

### Community 12 - "people-live.ts"
Cohesion: 0.24
Nodes (13): getAssignments(), getLivePeople(), getMemberMeta(), getRosterCounts(), isSharedMailbox(), MemberMeta, PeopleDirectoryData, PersonAssignment (+5 more)

### Community 13 - "Schema Apply Checks"
Cohesion: 0.06
Nodes (28): committed, cut, publicOnly, regenerated, schema, admin, DELIBERATELY_READABLE, env (+20 more)

### Community 14 - "team-lead-live.ts"
Cohesion: 0.12
Nodes (26): BoardRangeFilter(), PRESETS, fetchAllPaged(), PAGE, PagedResult, BOARD_WEEKS, BoardCellStatus, BoardPreset (+18 more)

### Community 15 - "Brand Mark Verifier"
Cohesion: 0.06
Nodes (28): AUTH, AUTH_C, authMarks, CSS, CSS_C, dAttrs, froms, heroIdx (+20 more)

### Community 16 - "Inventory Generation"
Cohesion: 0.10
Nodes (25): empty, inv, md, records, secrets, buildInventory(), classify(), collectWarnings() (+17 more)

### Community 17 - "Org Chart Edit Check"
Cohesion: 0.10
Nodes (21): admin, anon, cookies, env, errors, subordinate, time, member_clear_supervisor_source (+13 more)

### Community 18 - "time/page.tsx"
Cohesion: 0.17
Nodes (13): one(), ProjectsPage(), SORT_KEYS, RecordsTabKey, RecordsTabs(), parseWeekParam(), TimesheetsPage(), PageTransition() (+5 more)

### Community 19 - "time.ts"
Cohesion: 0.05
Nodes (57): args, DRY_RUN, ENV, get(), getAllPaged(), getEventsByMonth(), HEADERS, idMap() (+49 more)

### Community 20 - "AnalyticsCharts.tsx"
Cohesion: 0.13
Nodes (13): h(), TeamDeepAnalysis(), BumpSeries, DivergingBars(), DivergingItem, HeatCell, HeatmapMatrix(), LineSeries (+5 more)

### Community 21 - "Vendor Parity Check"
Cohesion: 0.08
Nodes (21): admin, env, headers, missing, now, ourCalendar, ourIds, ours (+13 more)

### Community 22 - "Dashboard Claims Recheck"
Cohesion: 0.08
Nodes (20): admin, corrected, distinctProjects, env, estimatedIds, gates, hasUnattributed, lastRef (+12 more)

### Community 23 - "time/actions.ts"
Cohesion: 0.09
Nodes (40): already, atFloor, crossing, justOver, msg, onBudget, placeholder, rounding (+32 more)

### Community 24 - "TeamLeadBoard.tsx"
Cohesion: 0.15
Nodes (19): ApprovalResult, approveAllPending(), approveDecision(), approveTimesheetWeek(), rejectTimesheetWeek(), requireApprover(), setTimesheetWeekStatus(), PendingTimesheetApprovals() (+11 more)

### Community 25 - "profile/actions.ts"
Cohesion: 0.09
Nodes (27): changePassword(), EXT, removeAvatar(), updateDisplayName(), updatePreferences(), uploadAvatar(), ALLOWED_AVATAR_TYPES, LANDING_PAGES (+19 more)

### Community 26 - "projects-live.ts"
Cohesion: 0.12
Nodes (29): h(), ProjectDetailPage(), BurnChart(), ContributorTable(), h(), ProjectTotalsStrip(), TaskTable(), allTimeFilters() (+21 more)

### Community 27 - "People Overview Agreement Check"
Cohesion: 0.09
Nodes (18): admin, completedByMember, currentByMember, currentMonday, drift, env, futureActivity, futureMembers (+10 more)

### Community 28 - "InsightPanels.tsx"
Cohesion: 0.11
Nodes (22): CustomerPortfolioCharts(), h(), SLICE_COLORS, CustomerPortfolioView, BAND, CapacityPanel(), h(), h() (+14 more)

### Community 29 - "ReportTables.tsx"
Cohesion: 0.19
Nodes (18): Align, cmpNum(), cmpText(), Column, csvCell(), DataTable(), PAGE_SIZES, PageSize (+10 more)

### Community 30 - "check-overview-range-narrows.mjs"
Cohesion: 0.13
Nodes (17): admin, biggest, byTeam, env, first12, iso(), lastDay12, lastMonday12 (+9 more)

### Community 31 - "MyLeavePanel.tsx"
Cohesion: 0.14
Nodes (18): ApprovalResult, approveLeaveRequestAction(), cancelLeaveRequest(), rejectLeaveRequestAction(), requestLeave(), RequestLeaveState, setLeaveRequestStatus(), MyLeavePanel() (+10 more)

### Community 32 - "(app)/page.tsx"
Cohesion: 0.14
Nodes (15): formatWeekLabel(), OverviewPage(), thursdayOf(), metadata, ProfilePage(), GET(), safeNext(), PageHeader() (+7 more)

### Community 33 - "TimesheetGrid.tsx"
Cohesion: 0.23
Nodes (15): AddEntryState, addTimesheetEntry(), copyLastWeek(), currentPersonId(), deleteTimesheetRow(), submitWeek(), updateDayHours(), withdrawWeek() (+7 more)

### Community 34 - "Sidebar Collapse Check"
Cohesion: 0.10
Nodes (16): CTX, dir, LAYOUT, mobileSrc, NAV, navSrc, navTourIds, require (+8 more)

### Community 35 - "Time Page Render Check"
Cohesion: 0.10
Nodes (15): alias, days, dir, emptyHtml, ghostHtml, listHtml, require, runningHtml (+7 more)

### Community 36 - "Missing Events Diagnosis"
Cohesion: 0.10
Nodes (17): admin, byMonth, daysDecl, dupes, earliest, env, headers, memberSourceIds (+9 more)

### Community 37 - "overview-live.ts"
Cohesion: 0.09
Nodes (33): OverviewFilters(), PRESETS, buildTeamOptions(), burnTone(), countRows(), fmtHours(), getLiveOverview(), getMemberTeams() (+25 more)

### Community 38 - "Paging & RLS Recheck"
Cohesion: 0.10
Nodes (15): admin, anon, app, asExec, bad, env, parRls, parSvc (+7 more)

### Community 39 - "PeopleDirectory.tsx"
Cohesion: 0.14
Nodes (21): bandOf(), CAPACITY_BANDS, CapacityBand, initialsOf(), PeopleDirectory(), SortKey, sortPeople(), Facet (+13 more)

### Community 40 - "Asana Backlog Check"
Cohesion: 0.14
Nodes (16): backwards, body, col(), controlBad, dupes, missingGate, RFC-4180, names (+8 more)

### Community 41 - "Time Acceptance Tests"
Cohesion: 0.12
Nodes (16): app, cleanup(), cleanupBuild(), customers, entries, monday, PROFILE, projects (+8 more)

### Community 42 - "label"
Cohesion: 0.43
Nodes (7): hrs(), label(), labelWithDate(), TrendChart(), TrendPoint, isoWeekNumber(), thursdayOf()

### Community 43 - "types.ts"
Cohesion: 0.12
Nodes (21): AddTaskForm(), TaskBoardView(), TaskListView(), TasksSection(), BillableTrend, BillableTrendPoint, BoardParent, ExecutiveMetricRow (+13 more)

### Community 44 - "Dashboard Tables Check"
Cohesion: 0.12
Nodes (15): app, cleanup(), customers, entries, members, monthStart, PROFILE, projects (+7 more)

### Community 45 - "TrackingTime Parity Check"
Cohesion: 0.12
Nodes (13): admin, env, evSeconds(), extra, extraSeconds, headers, missing, missingSeconds (+5 more)

### Community 46 - "Charts.tsx"
Cohesion: 0.17
Nodes (13): h(), TeamLeadCharts(), BillableDonut(), hrs(), AreaPoint, chartKindListeners, chartKindSubscribe(), Donut() (+5 more)

### Community 47 - "Sidebar.tsx"
Cohesion: 0.20
Nodes (7): BrandMark(), BrandMarkProps, PIECES, LogoutButton(), getUserInfo(), Sidebar(), TourReplayButton()

### Community 48 - "OAuth Success Path Check"
Cohesion: 0.18
Nodes (15): accessTokenFor(), app, arriveFromProvider(), arriveFromProviderStable(), b64(), build, cleanup(), currentUser (+7 more)

### Community 49 - "People Live Source Check"
Cohesion: 0.12
Nodes (14): active, activeWithTime, admin, archivedWithTime, distinctWeekly, env, future, linked (+6 more)

### Community 50 - "check-overview-filters.mjs"
Cohesion: 0.12
Nodes (11): board, boardPresets, boardQueries, filters, filtersCode, minePresets, page, pageCode (+3 more)

### Community 51 - "(app)/layout.tsx"
Cohesion: 0.16
Nodes (12): MobileSidebarDrawer(), MobileSidebarProps, SIDEBAR_COOKIE, SIDEBAR_COOKIE_MAX_AGE, SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH, SidebarCollapseContext, SidebarCollapseProvider() (+4 more)

### Community 52 - "No Mock People Check"
Cohesion: 0.13
Nodes (13): codeOnly(), files, invite, inviteAction, MOCK_TABLES, MOCKUP_NAMES, nameHits, read() (+5 more)

### Community 53 - "Server Action Auth Check"
Cohesion: 0.14
Nodes (11): app, authCookie, build, cleanup(), now, restoreTsconfig(), server, session (+3 more)

### Community 54 - "ProjectsExplorer.tsx"
Cohesion: 0.22
Nodes (13): CustomerMultiSelect(), h(), customerPortfolioFromRows(), CustomerShareRow, EMPTY_PROJECT_FILTERS, filterProjectRows(), hasActiveProjectFilters(), matchesProjectFacet() (+5 more)

### Community 55 - "Marketing Demo Page"
Cohesion: 0.12
Nodes (6): EASE, FEATURES, NOTE: preload must stay "none". With preload="metadata" Chrome starts a, STACK, STATS, T

### Community 56 - "measure-latency-variance.mjs"
Cohesion: 0.29
Nodes (4): admin, anon, app, env

### Community 57 - "Identity Linking Check"
Cohesion: 0.13
Nodes (11): anon, byEmail, detailed, env, forks, H, linkedUsers, mismatched (+3 more)

### Community 58 - "No Mock Data Check"
Cohesion: 0.14
Nodes (7): dash, hse, live, MOCK_TABLES, page, REPORTING_FILES, syncBar

### Community 59 - "TrackingTime Sync Script"
Cohesion: 0.14
Nodes (7): args, DRY_RUN, ENV, FULL, NO_LINK, SINCE_LAST, YEAR

### Community 60 - "TimerBar.tsx"
Cohesion: 0.29
Nodes (11): TimerBarSlot(), currentPersonId(), discardTimer(), startTimer(), stopTimer(), TimerResult, formatElapsed(), TimerBar() (+3 more)

### Community 61 - "Invite OAuth Model Check"
Cohesion: 0.15
Nodes (11): admin, byEmail, env, forked, invitedPending, multi, oauthLinked, profileIds (+3 more)

### Community 62 - "OAuth Callback Check"
Cohesion: 0.17
Nodes (11): buttons, fn, hostile, iCall, iMissingCode, iProviderCheck, iSet, leaks (+3 more)

### Community 63 - "Time Member Linking"
Cohesion: 0.18
Nodes (11): APPLY, authUsers, db, ENV, memberEmails, norm(), personIdByUser, plan (+3 more)

### Community 64 - "Marketing Video Page"
Cohesion: 0.17
Nodes (7): CONNECTORS, Feature, FEATURES, Stat, StatCard(), STATS, useCountUp()

### Community 65 - "Admin User Writes Check"
Cohesion: 0.17
Nodes (7): actions, admin, anon, dir, env, req, stub

### Community 66 - "Deployed Overview Check"
Cohesion: 0.17
Nodes (9): admin, anonClient, day, env, expectTotalHours, now, SITE, thisMonday (+1 more)

### Community 67 - "Profile RLS Check"
Cohesion: 0.17
Nodes (6): anon, anonHeaders, env, fixtureBytes, service, url

### Community 68 - "Sync & Drilldown Check"
Cohesion: 0.18
Nodes (10): FRESHNESS, IMPORT, LINKER, PAGE, PANELS, PKG, QUERIES, read() (+2 more)

### Community 69 - "Trend Window Check"
Cohesion: 0.17
Nodes (10): ascending, dashboard, emptyWindow, getter, newWindow, oldWindow, overview, shortWindow (+2 more)

### Community 70 - "User Management Check"
Cohesion: 0.21
Nodes (8): actionsAs(), admin, compile(), created, dir, env, posix(), req

### Community 71 - "Hours Definitions Explainer"
Cohesion: 0.18
Nodes (10): admin, archived, byMonth, DEFINITIONS, env, h(), rows, scored (+2 more)

### Community 72 - "Asana Backlog Generator"
Cohesion: 0.21
Nodes (11): addWorkingDays(), COLUMNS, csv, csvCell(), cursor, RFC-4180, PHASES, rows (+3 more)

### Community 73 - "Dashboard Cost Measurement"
Cohesion: 0.17
Nodes (10): env, gotParallel, headers, pages, pageTimes, WHY: the user asked for "quick reponses" and nothing in this module has ever, SELECT, t0 (+2 more)

### Community 74 - "check-people-filters-live.mjs"
Cohesion: 0.25
Nodes (5): admin, anon, cookies, env, errors

### Community 75 - "try-policy-verification-paths.mjs"
Cohesion: 0.20
Nodes (7): anyWorks, cli, credPath, env, logDir, results, tokens

### Community 76 - "Entry Policy Equivalence Check"
Cohesion: 0.18
Nodes (7): after, before, ROLES, schemaSrc, shippedMatch, text, wide

### Community 77 - "OnboardingTour.tsx"
Cohesion: 0.23
Nodes (10): DesktopSidebarShell(), IconPanelCollapse(), IconPanelExpand(), getCardStyle(), getTargetRect(), OnboardingTour(), Rect, STEPS (+2 more)

### Community 78 - "Profile Actions Check"
Cohesion: 0.20
Nodes (8): ACTIONS, bodies, changePasswordBody, constants, functionBody(), rawConstants, rawSrc, src

### Community 79 - "people/actions.ts"
Cohesion: 0.38
Nodes (5): setBillableRate(), SetBillableRateResult, BillableRatePanel(), handleSubmit(), BillableValueRow

### Community 80 - "Stale Total Tracing"
Cohesion: 0.18
Nodes (8): admin, archived, CANDIDATES, env, pageSrc, rows, TODAY, year

### Community 81 - "apply-rls-hoisting.mjs"
Cohesion: 0.22
Nodes (6): admin, alreadyHoisted, client, env, qualNow, ROLLBACK

### Community 82 - "Agent File References Check"
Cohesion: 0.20
Nodes (6): allFiles, fs, path, pkg, results, total

### Community 83 - "Approval Error Handling Check"
Cohesion: 0.20
Nodes (8): actions, actionsPath, all, board, boardPath, checks, fs, path

### Community 84 - "Org Chart Check"
Cohesion: 0.20
Nodes (4): dir, mod, peopleStub, req

### Community 85 - "Schema Execution Check"
Cohesion: 0.20
Nodes (8): expectedFns, expectedTables, got, gotFns, missingFns, missingTables, sql, upd

### Community 86 - "Time Write Path Check"
Cohesion: 0.20
Nodes (5): ACTIONS, here, PAGE, root, TRACKER

### Community 87 - "Member Provisioning Script"
Cohesion: 0.20
Nodes (9): admin, APPLY, eligible, env, INVITE, profiledUserIds, ROLE_MAP, skipped (+1 more)

### Community 88 - "check-duration-parsing.mjs"
Cohesion: 0.39
Nodes (6): check(), eq(), fmt(), rejects, formatDuration(), parseDuration()

### Community 89 - "Google Client Check"
Cohesion: 0.22
Nodes (6): accounts, adcPath, env, needsReauth, probe, token

### Community 90 - "Schema Order Check"
Cohesion: 0.22
Nodes (8): assertions, definedFunctions, definedTables, fs, knownFnNames, lines, problems, sql

### Community 91 - "SSO Provider Check"
Cohesion: 0.25
Nodes (7): anon, env, get(), needed, probe(), siteUrl, url

### Community 92 - "Time Org Chart View Check"
Cohesion: 0.22
Nodes (7): executable, FORBIDDEN, leaked, migration, missing, names, REQUIRED

### Community 93 - "Agent Claim Recheck"
Cohesion: 0.22
Nodes (6): { execFileSync }, files, fs, graders, rerunExists, untested

### Community 95 - "ReportPanels.tsx"
Cohesion: 0.31
Nodes (7): age(), FreshnessBanner(), hrs(), stamp(), TotalsStrip(), SyncFreshness, Totals

### Community 96 - "Agent Claims Check"
Cohesion: 0.25
Nodes (6): board, firstFn, firstRolePolicy, fs, pkg, schema

### Community 97 - "Dashboard Acceptance Check"
Cohesion: 0.25
Nodes (5): admin, anonClient, app, env, results

### Community 98 - "Economics Scope Check"
Cohesion: 0.25
Nodes (3): callAt, pageSrc, unattributed

### Community 99 - "Lint Scope Check"
Cohesion: 0.25
Nodes (6): eslintCfg, eslintCfgRaw, fs, gitignore, gitNextDirs, globCoversAll

### Community 100 - "Login Redirect Safety Checks"
Cohesion: 0.29
Nodes (6): fn, hostile, naive(), naiveLeaks, safeRedirect, src

### Community 101 - "OAuth Success Path Verification"
Cohesion: 0.25
Nodes (4): admin, app, env, stamp

### Community 102 - "Page Length Render Check"
Cohesion: 0.25
Nodes (4): admin, anon, cookies, env

### Community 103 - "Parallel Paging Performance Test"
Cohesion: 0.25
Nodes (4): CASES, env, root, supabase

### Community 104 - "Permissions RLS Parity Check"
Cohesion: 0.29
Nodes (6): as(), can(), codeKeys, dbSet, missingInCode, missingInDb

### Community 105 - "Provisioned Access Verification"
Cohesion: 0.25
Nodes (6): admin, anon, asThem, env, memberIdsSeen, subject

### Community 106 - "Remote Deploy State Check"
Cohesion: 0.25
Nodes (4): checks, { execFileSync }, head, remoteFiles

### Community 107 - "RLS Query Hoisting Benchmark"
Cohesion: 0.29
Nodes (5): admin, anon, env, median(), runs()

### Community 108 - "User Management UI Check"
Cohesion: 0.25
Nodes (5): admin, anon, cookies, env, errors

### Community 109 - "TrackingTime Integration Check"
Cohesion: 0.29
Nodes (5): HERE, SOURCE, threw(), tt, unwrap()

### Community 110 - "AI Provider Credential Probes"
Cohesion: 0.39
Nodes (6): CRED_PATH, DEFAULT_PROJECT, freshAccessToken(), loadStoredCreds(), oauthClient(), auth

### Community 111 - "Deployment Wait Helper"
Cohesion: 0.25
Nodes (7): admin, anon, cookie, env, MAX_WAIT_MS, parts, started

### Community 112 - "Root Layout And Fonts"
Cohesion: 0.25
Nodes (6): cormorant, jetbrains, metadata, plusJakarta, poppins, spaceGrotesk

### Community 113 - "Auth Route Gate Checks"
Cohesion: 0.29
Nodes (4): middleware, publicRoutes, publicRoutesBlock, routes

### Community 114 - "Charts UI Check"
Cohesion: 0.29
Nodes (5): admin, anon, cookies, env, errors

### Community 115 - "Live Dashboard Check"
Cohesion: 0.29
Nodes (4): admin, anonClient, app, env

### Community 116 - "People And Filters UI Check"
Cohesion: 0.29
Nodes (5): admin, anon, cookies, env, errors

### Community 117 - "Records Tabs Source Check"
Cohesion: 0.29
Nodes (4): dashSrc, sheetsSrc, tabsSrc, timeSrc

### Community 118 - "Redirect Allowlist Check"
Cohesion: 0.29
Nodes (5): cases, env, failures, SITE, URL_BASE

### Community 119 - "Team Analysis UI Check"
Cohesion: 0.38
Nodes (5): admin, cookiesFor(), env, pageText(), wait()

### Community 120 - "Theme And Figures Check"
Cohesion: 0.29
Nodes (5): admin, anon, cookies, env, errors

### Community 122 - "Google OAuth Error Diagnosis"
Cohesion: 0.29
Nodes (6): env, g, googleUrl, SIGNS, state, text

### Community 123 - "check-trackingtime-report.mjs"
Cohesion: 0.15
Nodes (9): CODE, ENV, here, NAV_SRC, NOW, PAGE_SRC, PROJECTS, root (+1 more)

### Community 124 - "ThemeToggle.tsx"
Cohesion: 0.43
Nodes (4): getServerSnapshot(), getSnapshot(), subscribe(), ThemeToggle()

### Community 125 - "Auth Session Middleware"
Cohesion: 0.38
Nodes (5): config, proxy(), PUBLIC_PREFIXES, PUBLIC_ROUTES, updateSession()

### Community 126 - "Live Database Audit"
Cohesion: 0.33
Nodes (3): counts, env, findings

### Community 130 - "Redirect Guard Logic Check"
Cohesion: 0.33
Nodes (3): backslash, HOSTILE, src

### Community 131 - "Time Page Live Readiness"
Cohesion: 0.33
Nodes (3): env, headers, url

### Community 132 - "Time Page Data Check"
Cohesion: 0.33
Nodes (4): dashboardRepair, hrefRepair, schemaSql, utilisation

### Community 133 - "Policy Verification Query Check"
Cohesion: 0.40
Nodes (4): byFix, query, run(), schema

### Community 134 - "Null Assignments Diagnosis"
Cohesion: 0.33
Nodes (4): env, nameToProjects, nulls, personName

### Community 135 - "Migration Module Generator"
Cohesion: 0.33
Nodes (5): beforeStart, body, out, schema, startMarker

### Community 136 - "OAuth Invite Linking Proof"
Cohesion: 0.33
Nodes (4): admin, created, env, stamp

### Community 137 - "Economics Access Recheck"
Cohesion: 0.33
Nodes (4): admin, anon, env, execClient

### Community 138 - "Demo Video Recorder"
Cohesion: 0.33
Nodes (4): OUT_DIR, Scene, SCENES, SCREENSHOTS_DIR

### Community 139 - "Sync Secrets Setup"
Cohesion: 0.33
Nodes (4): dryRun, env, missing, REQUIRED

### Community 140 - "Yearly Screenshot Capture"
Cohesion: 0.33
Nodes (4): admin, anon, app, env

### Community 141 - "Policy Gate Failure Verification"
Cohesion: 0.33
Nodes (3): final, original, originalHash

### Community 142 - "permissions.ts"
Cohesion: 0.21
Nodes (13): LeavePage(), metadata, PortalPage(), ModuleKey, ModuleTile, PermissionKey, ROUTE_PERMISSIONS, getLeaveBalance() (+5 more)

### Community 144 - "Deploy Skew Check"
Cohesion: 0.40
Nodes (3): config, layout, stripped

### Community 145 - "Modules RLS Check"
Cohesion: 0.50
Nodes (3): as(), byCmd, modulesFor()

### Community 148 - "Production Config Check"
Cohesion: 0.40
Nodes (4): env, refs, scripts, unique

### Community 150 - "Sync Freshness Check"
Cohesion: 0.40
Nodes (4): env, headers, hours, lastOk

### Community 151 - "Backend Agent Grading"
Cohesion: 0.40
Nodes (3): control, KEY, treatment

### Community 152 - "Testing Agent Grading"
Cohesion: 0.40
Nodes (4): control, KEY, missedByControl, treatment

### Community 154 - "Anonymous Write Verification"
Cohesion: 0.40
Nodes (3): after, env, rows

### Community 155 - "createClient"
Cohesion: 0.14
Nodes (29): toggleRolePermission(), AdminRolesPage(), PermissionToggle(), handleToggle(), Props, AdminUsersPage(), PeoplePage(), TeamLeadPage() (+21 more)

### Community 156 - "Next.js Build Config"
Cohesion: 0.50
Nodes (3): nextConfig, NOTE: do NOT add an `env: { NEXT_PUBLIC_SITE_URL: ... }` block here., requiredEnvVars

### Community 165 - "Frontend Agent Grading"
Cohesion: 0.50
Nodes (3): control, KEY, treatment

### Community 166 - "Machine State Export"
Cohesion: 0.83
Nodes (3): Add-Result(), Copy-One(), Copy-Tree()

### Community 167 - "Requirements Traceability Run"
Cohesion: 0.50
Nodes (3): needsServer, REQUIREMENTS, results

### Community 168 - "Provider Status Endpoint"
Cohesion: 0.67
Nodes (3): classify(), GET(), PROVIDERS

### Community 170 - "Member Utilisation Bounding"
Cohesion: 0.50
Nodes (3): time.member, time.member_utilisation, time.entry

### Community 171 - "Project Sections And Tasks"
Cohesion: 0.67
Nodes (3): public.project_sections, public.project_tasks, time.project

### Community 214 - "time-dashboard.ts"
Cohesion: 0.13
Nodes (25): CustomerTable(), EconomicsTable(), eur(), hrs(), MemberTable(), OrgTotalsStrip(), ProjectTable(), relativeDays() (+17 more)

### Community 226 - "dashboard/page.tsx"
Cohesion: 0.21
Nodes (19): bucketRange(), BUCKETS, GROUPS, one(), TrackingTimeDashboardPage(), getProjectEconomics(), getSyncFreshness(), numOrNull() (+11 more)

### Community 227 - "PortfolioCharts.tsx"
Cohesion: 0.52
Nodes (6): BurnDonutRow(), h(), PortfolioCharts(), SLICE_TO_FACET, burnColor(), matchesFacet()

### Community 228 - "read-prod-total.mjs"
Cohesion: 0.50
Nodes (3): admin, anon, env

### Community 231 - "database.types.ts"
Cohesion: 0.18
Nodes (10): CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums, Json, Tables (+2 more)

### Community 232 - "ReportFilters.tsx"
Cohesion: 0.29
Nodes (4): Option, ReportFilters(), PresetKey, PRESETS

### Community 233 - "check-hr-role-migration.mjs"
Cohesion: 0.33
Nodes (4): execKeys, hrKeys, migration, names

### Community 234 - "hse.ts"
Cohesion: 0.18
Nodes (7): getProjectDetail(), getTaskComments(), getTimeProjectBoard(), nestTasks(), OrgChartNode, PersonProfile, ProjectDetail

### Community 236 - "BudgetPanel.tsx"
Cohesion: 0.50
Nodes (3): BudgetPanel(), euro(), ProjectBudgetStatusRow

### Community 239 - "TeamLeadExplorer.tsx"
Cohesion: 0.27
Nodes (10): groupByTeam(), h(), TeamAnalysis(), TeamAnalysisSection(), TeamBlock, TeamChoice, TeamLeadExplorer(), BoardRow (+2 more)

## Knowledge Gaps
- **1223 isolated node(s):** `name`, `version`, `private`, `dev`, `build` (+1218 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **40 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createClient()` connect `createClient` to `(app)/page.tsx`, `TimesheetGrid.tsx`, `dashboard/page.tsx`, `users/actions.ts`, `projects/actions.ts`, `permissions.ts`, `people/actions.ts`, `Sidebar.tsx`, `time/page.tsx`, `time.ts`, `time/actions.ts`, `TeamLeadBoard.tsx`, `profile/actions.ts`, `projects-live.ts`, `TimerBar.tsx`, `MyLeavePanel.tsx`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `label()` connect `label` to `Dashboard Acceptance Check`, `OAuth Success Path Verification`, `Time Acceptance Tests`, `check-projects-module.mjs`, `measure-latency-variance.mjs`, `SSO Provider Check`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `Database` connect `database.types.ts` to `(app)/page.tsx`, `users/actions.ts`, `AuthShell.tsx`, `overview-live.ts`, `trackingtime-report.ts`, `types.ts`, `people-live.ts`, `team-lead-live.ts`, `time.ts`, `time-dashboard.ts`, `projects-live.ts`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _1223 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.014492753623188406 - nodes in this community are weakly interconnected._
- **Should `Standalone Runtime Bootstrap` be split into smaller, more focused modules?**
  _Cohesion score 0.060678962844159315 - nodes in this community are weakly interconnected._
- **Should `Roles & Permissions Schema` be split into smaller, more focused modules?**
  _Cohesion score 0.05384615384615385 - nodes in this community are weakly interconnected._