# Graph Report - Supabase  (2026-08-21)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2758 nodes · 4291 edges · 227 communities (191 shown, 36 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 63 edges (avg confidence: 0.85)
- Token cost: 170,380 input · 3,173 output

## Graph Freshness
- Built from commit: `dbdf8c57`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- NPM Scripts Manifest
- Standalone Runtime Bootstrap
- Roles & Permissions Schema
- Team Select Verifier
- People Directory & Form Fields
- Project Task Actions
- Navigation Icon Set
- Module Verification Scripts
- Design System Check
- TypeScript Config Includes
- Time Tracking Dashboard
- Package Dependencies
- People Page & DB Types
- Schema Apply Checks
- Admin Roles & Permissions UI
- Brand Mark Verifier
- Inventory Generation
- Org Chart Edit Check
- Projects Pages & Panels
- Time Page Tabs & Helpers
- Deep Analytics Charts
- Vendor Parity Check
- Dashboard Claims Recheck
- Time Entry Server Actions
- Timesheet Approval Actions
- Profile Settings Actions
- Live Projects Queries
- People Overview Agreement Check
- Dashboard Panel Tables
- Sortable Data Tables
- Live Overview Queries
- Leave Approval Actions
- Overview & Timesheet Pages
- Timesheet Entry Actions
- Sidebar Collapse Check
- Time Page Render Check
- Missing Events Diagnosis
- TrackingTime Import Script
- Paging & RLS Recheck
- Project Insights Filtering
- Asana Backlog Check
- Time Acceptance Tests
- Time Data Transform
- Leave Request UI
- Dashboard Tables Check
- TrackingTime Parity Check
- Customer Portfolio Charts
- Brand Mark & Sidebar
- OAuth Success Path Check
- People Live Source Check
- Portfolio Charts & Ledger
- Team Lead Analysis Views
- No Mock People Check
- Server Action Auth Check
- Time Entry List Views
- Marketing Demo Page
- Latency & Prod Probes
- Identity Linking Check
- No Mock Data Check
- TrackingTime Sync Script
- Running Timer Bar
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
- App Layout & Sidebar Shell
- Policy Verification Probe
- Entry Policy Equivalence Check
- Onboarding Tour & Collapse
- Profile Actions Check
- Profile & Portal Pages
- Stale Total Tracing
- RLS Hoisting Migration
- Agent File References Check
- Approval Error Handling Check
- Org Chart Check
- Schema Execution Check
- Time Write Path Check
- Member Provisioning Script
- Avatar Monogram
- Google Client Check
- Schema Order Check
- SSO Provider Check
- Time Org Chart View Check
- Agent Claim Recheck
- Loading Skeletons
- Report Panels & Freshness
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
- Billable Rate Management
- Theme Toggle
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
- Time View Tabs
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
- Button Component
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
- Time Member Model
- Sidebar Navigation
- Stale Deploy Notice

## God Nodes (most connected - your core abstractions)
1. `scripts` - 136 edges
2. `createClient()` - 86 edges
3. `secondsToHours()` - 32 edges
4. `get()` - 23 edges
5. `createRuntime()` - 22 edges
6. `TrackingTimeDashboardPage()` - 20 edges
7. `include` - 19 edges
8. `userHasPermission()` - 18 edges
9. `PERMISSIONS` - 17 edges
10. `TimePage()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `render()` --indirect_call--> `UserRow()`  [INFERRED]
  scripts/check-team-select.mjs → src/app/(app)/admin/users/UserRow.tsx
- `main()` --calls--> `toEntryDraft()`  [EXTRACTED]
  scripts/import-trackingtime.mjs → src/lib/time-transform.ts
- `app_user_role_v2()` --reads_from--> `app_user_profile`  [EXTRACTED]
  scripts/eval/reports-module.sql → supabase/schema.sql
- `CustomerPortfolio` --calls--> `secondsToHours()`  [EXTRACTED]
  src/lib/queries/projects-live.ts → src/lib/time-transform.ts
- `CustomerRankByMonth` --calls--> `secondsToHours()`  [EXTRACTED]
  src/lib/queries/projects-live.ts → src/lib/time-transform.ts

## Import Cycles
- None detected.

## Communities (227 total, 36 thin omitted)

### Community 0 - "NPM Scripts Manifest"
Cohesion: 0.01
Nodes (136): scripts, apply-modules, asana:backlog, build, check:acceptance, check:action-auth, check:admin-user-writes, check:avatar (+128 more)

### Community 1 - "Standalone Runtime Bootstrap"
Cohesion: 0.06
Nodes (75): boot(), bundledBlob(), cdnScriptFor(), collectProps(), compileAttr(), compileTemplate(), contentKey(), createComponentFactory() (+67 more)

### Community 2 - "Roles & Permissions Schema"
Cohesion: 0.05
Nodes (55): auth, app_user_role_v2(), can_view_report(), people, reports, app_module, app_permission, app_role_permission (+47 more)

### Community 3 - "Team Select Verifier"
Cohesion: 0.06
Nodes (52): actionsStub, dir, editable, legacyOptions, legacyRow, React, readOnly, readOnlyLegacy (+44 more)

### Community 4 - "People Directory & Form Fields"
Cohesion: 0.18
Nodes (12): initialsOf(), PeopleDirectory(), SortKey, sortPeople(), FilterChip(), SearchableSelect(), SearchInput(), SortDirection (+4 more)

### Community 5 - "Project Task Actions"
Cohesion: 0.07
Nodes (44): addComment(), addSubtask(), createSection(), createTask(), CreateTaskState, deleteComment(), deleteTask(), insertTask() (+36 more)

### Community 6 - "Navigation Icon Set"
Cohesion: 0.12
Nodes (4): IconPanelCollapse(), IconPanelExpand(), IconProps, IconSearch()

### Community 7 - "Module Verification Scripts"
Cohesion: 0.04
Nodes (26): dir, require, dir, require, alias, anon, days, dir (+18 more)

### Community 8 - "Design System Check"
Cohesion: 0.05
Nodes (43): APP_SHELL, authInput, authShell, buttonSrc, card, chartsSrc, check(), chrome (+35 more)

### Community 9 - "TypeScript Config Includes"
Cohesion: 0.05
Nodes (40): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next-flake-probe/dev/types/**/*.ts, .next-flake-probe/types/**/*.ts (+32 more)

### Community 10 - "Time Tracking Dashboard"
Cohesion: 0.12
Nodes (34): bucketRange(), BUCKETS, GROUPS, one(), TrackingTimeDashboardPage(), Option, ReportFilters(), capacityByMember() (+26 more)

### Community 11 - "Package Dependencies"
Cohesion: 0.05
Nodes (37): @electric-sql/pglite, eslint, eslint-config-next, framer-motion, next, dependencies, framer-motion, next (+29 more)

### Community 12 - "People Page & DB Types"
Cohesion: 0.08
Nodes (33): PeoplePage(), PeopleSection(), CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums (+25 more)

### Community 13 - "Schema Apply Checks"
Cohesion: 0.06
Nodes (28): committed, cut, publicOnly, regenerated, schema, admin, DELIBERATELY_READABLE, env (+20 more)

### Community 14 - "Admin Roles & Permissions UI"
Cohesion: 0.13
Nodes (27): toggleRolePermission(), AdminRolesPage(), PermissionToggle(), handleToggle(), Props, AdminUsersPage(), TeamLeadPage(), IconWarning() (+19 more)

### Community 15 - "Brand Mark Verifier"
Cohesion: 0.06
Nodes (28): AUTH, AUTH_C, authMarks, CSS, CSS_C, dAttrs, froms, heroIdx (+20 more)

### Community 16 - "Inventory Generation"
Cohesion: 0.10
Nodes (25): empty, inv, md, records, secrets, buildInventory(), classify(), collectWarnings() (+17 more)

### Community 17 - "Org Chart Edit Check"
Cohesion: 0.10
Nodes (21): admin, anon, cookies, env, errors, subordinate, time, member_clear_supervisor_source (+13 more)

### Community 18 - "Projects Pages & Panels"
Cohesion: 0.17
Nodes (15): h(), ProjectDetailPage(), one(), ProjectsPage(), SORT_KEYS, BurnChart(), ContributorTable(), h() (+7 more)

### Community 19 - "Time Page Tabs & Helpers"
Cohesion: 0.18
Nodes (24): RecordsTabKey, RecordsTabs(), parseScopeParam(), parseViewParam(), parseWeekParam(), TimePage(), currentTimeWeek(), dayBounds() (+16 more)

### Community 20 - "Deep Analytics Charts"
Cohesion: 0.10
Nodes (20): h(), TeamDeepAnalysis(), h(), InsightPanels(), SERIES, BumpSeries, DivergingBars(), DivergingItem (+12 more)

### Community 21 - "Vendor Parity Check"
Cohesion: 0.08
Nodes (21): admin, env, headers, missing, now, ourCalendar, ourIds, ours (+13 more)

### Community 22 - "Dashboard Claims Recheck"
Cohesion: 0.08
Nodes (20): admin, corrected, distinctProjects, env, estimatedIds, gates, hasUnattributed, lastRef (+12 more)

### Community 23 - "Time Entry Server Actions"
Cohesion: 0.20
Nodes (21): authorise(), Client, combineInstant(), createEntry(), deleteEntry(), discardTimer(), optionalId(), optionalText() (+13 more)

### Community 24 - "Timesheet Approval Actions"
Cohesion: 0.09
Nodes (35): ApprovalResult, approveAllPending(), approveDecision(), approveTimesheetWeek(), rejectTimesheetWeek(), requireApprover(), setTimesheetWeekStatus(), BoardRangeFilter() (+27 more)

### Community 25 - "Profile Settings Actions"
Cohesion: 0.07
Nodes (35): changePassword(), EXT, removeAvatar(), updateDisplayName(), updatePreferences(), uploadAvatar(), ALLOWED_AVATAR_TYPES, LANDING_PAGES (+27 more)

### Community 26 - "Live Projects Queries"
Cohesion: 0.13
Nodes (24): allTimeFilters(), burndown(), BurnPoint, contributors(), CustomerPortfolio, CustomerPortfolioRow, CustomerRankByMonth, CustomerRankSeries (+16 more)

### Community 27 - "People Overview Agreement Check"
Cohesion: 0.09
Nodes (18): admin, completedByMember, currentByMember, currentMonday, drift, env, futureActivity, futureMembers (+10 more)

### Community 28 - "Dashboard Panel Tables"
Cohesion: 0.16
Nodes (19): CustomerTable(), EconomicsTable(), eur(), hrs(), MemberTable(), OrgTotalsStrip(), ProjectTable(), relativeDays() (+11 more)

### Community 29 - "Sortable Data Tables"
Cohesion: 0.16
Nodes (20): Align, cmpNum(), cmpText(), Column, csvCell(), DataTable(), PAGE_SIZES, PageSize (+12 more)

### Community 30 - "Live Overview Queries"
Cohesion: 0.15
Nodes (22): burnTone(), countRows(), fmtHours(), getLiveOverview(), OVERVIEW_WEEKS, OverviewData, OverviewMetric, OverviewProject (+14 more)

### Community 31 - "Leave Approval Actions"
Cohesion: 0.31
Nodes (10): ApprovalResult, approveLeaveRequestAction(), cancelLeaveRequest(), rejectLeaveRequestAction(), RequestLeaveState, setLeaveRequestStatus(), PendingLeaveApprovals(), GET() (+2 more)

### Community 32 - "Overview & Timesheet Pages"
Cohesion: 0.18
Nodes (13): formatWeekLabel(), OverviewPage(), thursdayOf(), parseWeekParam(), TimesheetsPage(), describeAge(), SyncBar(), TopBarChrome() (+5 more)

### Community 33 - "Timesheet Entry Actions"
Cohesion: 0.16
Nodes (20): check(), eq(), fmt(), rejects, AddEntryState, addTimesheetEntry(), copyLastWeek(), currentPersonId() (+12 more)

### Community 34 - "Sidebar Collapse Check"
Cohesion: 0.10
Nodes (16): CTX, dir, LAYOUT, mobileSrc, NAV, navSrc, navTourIds, require (+8 more)

### Community 35 - "Time Page Render Check"
Cohesion: 0.10
Nodes (15): alias, days, dir, emptyHtml, ghostHtml, listHtml, require, runningHtml (+7 more)

### Community 36 - "Missing Events Diagnosis"
Cohesion: 0.10
Nodes (17): admin, byMonth, daysDecl, dupes, earliest, env, headers, memberSourceIds (+9 more)

### Community 37 - "TrackingTime Import Script"
Cohesion: 0.17
Nodes (16): args, DRY_RUN, ENV, get(), getAllPaged(), getEventsByMonth(), HEADERS, idMap() (+8 more)

### Community 38 - "Paging & RLS Recheck"
Cohesion: 0.10
Nodes (15): admin, anon, app, asExec, bad, env, parRls, parSvc (+7 more)

### Community 39 - "Project Insights Filtering"
Cohesion: 0.22
Nodes (13): CustomerMultiSelect(), h(), customerPortfolioFromRows(), CustomerShareRow, EMPTY_PROJECT_FILTERS, filterProjectRows(), hasActiveProjectFilters(), matchesProjectFacet() (+5 more)

### Community 40 - "Asana Backlog Check"
Cohesion: 0.14
Nodes (16): backwards, body, col(), controlBad, dupes, missingGate, RFC-4180, names (+8 more)

### Community 41 - "Time Acceptance Tests"
Cohesion: 0.12
Nodes (16): app, cleanup(), cleanupBuild(), customers, entries, monday, PROFILE, projects (+8 more)

### Community 42 - "Time Data Transform"
Cohesion: 0.19
Nodes (13): hrs(), label(), labelWithDate(), TrendChart(), TrendPoint, EntryDraft, FlatEvent, isCalendarSourced() (+5 more)

### Community 43 - "Leave Request UI"
Cohesion: 0.09
Nodes (23): requestLeave(), MyLeavePanel(), LeavePage(), IconArrowRight(), STATUS_TONE, StatusBadge(), Tone, TONE_CLASS (+15 more)

### Community 44 - "Dashboard Tables Check"
Cohesion: 0.12
Nodes (15): app, cleanup(), customers, entries, members, monthStart, PROFILE, projects (+7 more)

### Community 45 - "TrackingTime Parity Check"
Cohesion: 0.12
Nodes (13): admin, env, evSeconds(), extra, extraSeconds, headers, missing, missingSeconds (+5 more)

### Community 46 - "Customer Portfolio Charts"
Cohesion: 0.15
Nodes (14): CustomerPortfolioCharts(), h(), SLICE_COLORS, CustomerPortfolioView, BAND, CapacityPanel(), h(), Card() (+6 more)

### Community 47 - "Brand Mark & Sidebar"
Cohesion: 0.31
Nodes (6): BrandMark(), BrandMarkProps, PIECES, getUserInfo(), Sidebar(), TourReplayButton()

### Community 48 - "OAuth Success Path Check"
Cohesion: 0.18
Nodes (15): accessTokenFor(), app, arriveFromProvider(), arriveFromProviderStable(), b64(), build, cleanup(), currentUser (+7 more)

### Community 49 - "People Live Source Check"
Cohesion: 0.12
Nodes (14): active, activeWithTime, admin, archivedWithTime, distinctWeekly, env, future, linked (+6 more)

### Community 50 - "Portfolio Charts & Ledger"
Cohesion: 0.21
Nodes (14): BurnDonutRow(), h(), PortfolioCharts(), SLICE_TO_FACET, burnColor(), Facet, h(), LedgerSort (+6 more)

### Community 51 - "Team Lead Analysis Views"
Cohesion: 0.11
Nodes (23): groupByTeam(), h(), TeamAnalysis(), TeamAnalysisSection(), TeamBlock, h(), TeamLeadCharts(), TeamChoice (+15 more)

### Community 52 - "No Mock People Check"
Cohesion: 0.13
Nodes (13): codeOnly(), files, invite, inviteAction, MOCK_TABLES, MOCKUP_NAMES, nameHits, read() (+5 more)

### Community 53 - "Server Action Auth Check"
Cohesion: 0.14
Nodes (11): app, authCookie, build, cleanup(), now, restoreTsconfig(), server, session (+3 more)

### Community 54 - "Time Entry List Views"
Cohesion: 0.17
Nodes (10): clock(), EntryRow(), formatDayHeading(), TimeEntryList(), TimeTotalsStrip(), WeekSummaryTable(), TimeEntryRow, TimeTotals (+2 more)

### Community 55 - "Marketing Demo Page"
Cohesion: 0.12
Nodes (6): EASE, FEATURES, NOTE: preload must stay "none". With preload="metadata" Chrome starts a, STACK, STATS, T

### Community 56 - "Latency & Prod Probes"
Cohesion: 0.13
Nodes (7): admin, anon, app, env, admin, anon, env

### Community 57 - "Identity Linking Check"
Cohesion: 0.13
Nodes (11): anon, byEmail, detailed, env, forks, H, linkedUsers, mismatched (+3 more)

### Community 58 - "No Mock Data Check"
Cohesion: 0.14
Nodes (7): dash, hse, live, MOCK_TABLES, page, REPORTING_FILES, syncBar

### Community 59 - "TrackingTime Sync Script"
Cohesion: 0.14
Nodes (7): args, DRY_RUN, ENV, FULL, NO_LINK, SINCE_LAST, YEAR

### Community 60 - "Running Timer Bar"
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

### Community 74 - "App Layout & Sidebar Shell"
Cohesion: 0.21
Nodes (9): MobileSidebarDrawer(), MobileSidebarProps, SIDEBAR_COOKIE, SIDEBAR_COOKIE_MAX_AGE, SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH, SidebarCollapseContext, SidebarCollapseProvider() (+1 more)

### Community 75 - "Policy Verification Probe"
Cohesion: 0.18
Nodes (7): anyWorks, cli, credPath, env, logDir, results, tokens

### Community 76 - "Entry Policy Equivalence Check"
Cohesion: 0.18
Nodes (7): after, before, ROLES, schemaSrc, shippedMatch, text, wide

### Community 77 - "Onboarding Tour & Collapse"
Cohesion: 0.31
Nodes (8): DesktopSidebarShell(), getCardStyle(), getTargetRect(), OnboardingTour(), Rect, STEPS, useSidebarCollapse(), SidebarToggle()

### Community 78 - "Profile Actions Check"
Cohesion: 0.20
Nodes (8): ACTIONS, bodies, changePasswordBody, constants, functionBody(), rawConstants, rawSrc, src

### Community 79 - "Profile & Portal Pages"
Cohesion: 0.18
Nodes (11): EmploymentCard(), metadata, ProfilePage(), metadata, PortalPage(), getUserModules(), isModuleReachable(), effectiveNameOf() (+3 more)

### Community 80 - "Stale Total Tracing"
Cohesion: 0.18
Nodes (8): admin, archived, CANDIDATES, env, pageSrc, rows, TODAY, year

### Community 81 - "RLS Hoisting Migration"
Cohesion: 0.20
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

### Community 88 - "Avatar Monogram"
Cohesion: 0.46
Nodes (4): Avatar(), colorForName(), initialsOf(), PALETTE

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

### Community 95 - "Report Panels & Freshness"
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

### Community 123 - "Billable Rate Management"
Cohesion: 0.38
Nodes (5): setBillableRate(), SetBillableRateResult, BillableRatePanel(), handleSubmit(), BillableValueRow

### Community 124 - "Theme Toggle"
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

### Community 142 - "Time View Tabs"
Cohesion: 0.47
Nodes (4): formatDay(), TimeViewTabs(), shiftDay(), shiftWeek()

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

### Community 155 - "Button Component"
Cohesion: 0.32
Nodes (7): Button(), buttonClass(), ButtonLink(), Size, SIZES, Variant, VARIANTS

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

### Community 225 - "Sidebar Navigation"
Cohesion: 0.33
Nodes (5): IconDot(), NAV_ICONS, NAV_GROUPS, NavGroup, SidebarNav()

### Community 226 - "Stale Deploy Notice"
Cohesion: 0.67
Nodes (3): looksLikeSkew(), SKEW_SIGNATURES, StaleDeployNotice()

## Knowledge Gaps
- **1169 isolated node(s):** `Option`, `FetchResult`, `FilterOptions`, `SupabaseTyped`, `CompositeTypes` (+1164 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **36 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createClient()` connect `Leave Approval Actions` to `Overview & Timesheet Pages`, `Timesheet Entry Actions`, `Team Select Verifier`, `Project Task Actions`, `Time Tracking Dashboard`, `Leave Request UI`, `People Page & DB Types`, `Admin Roles & Permissions UI`, `Profile & Portal Pages`, `Brand Mark & Sidebar`, `Projects Pages & Panels`, `Time Page Tabs & Helpers`, `Time Entry Server Actions`, `Timesheet Approval Actions`, `Profile Settings Actions`, `Billable Rate Management`, `Running Timer Bar`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `Database` connect `People Page & DB Types` to `Overview & Timesheet Pages`, `Team Select Verifier`, `Project Task Actions`, `Time Tracking Dashboard`, `Time Page Tabs & Helpers`, `Timesheet Approval Actions`, `Profile Settings Actions`, `Live Projects Queries`, `Dashboard Panel Tables`, `Live Overview Queries`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `label()` connect `Time Data Transform` to `Dashboard Acceptance Check`, `OAuth Success Path Verification`, `Module Verification Scripts`, `Time Acceptance Tests`, `Latency & Prod Probes`, `SSO Provider Check`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `createRuntime()` (e.g. with `adoptParsed()` and `dcUpdate()`) actually correct?**
  _`createRuntime()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Option`, `FetchResult`, `FilterOptions` to the rest of the system?**
  _1169 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `NPM Scripts Manifest` be split into smaller, more focused modules?**
  _Cohesion score 0.014705882352941176 - nodes in this community are weakly interconnected._
- **Should `Standalone Runtime Bootstrap` be split into smaller, more focused modules?**
  _Cohesion score 0.060678962844159315 - nodes in this community are weakly interconnected._